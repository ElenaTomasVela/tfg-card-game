import { jwt } from "@elysiajs/jwt";
import { Server } from "bun";
import swagger from "@elysiajs/swagger";
import { Elysia, NotFoundError, ValidationError, t } from "elysia";
import {
  IUser,
  User,
  checkCredentials,
  encryptUser,
  tUser,
} from "./models/user";
import cors from "@elysiajs/cors";
import {
  WaitingRoom,
  tWaitingRoomMessage,
  IWaitingRoomServerMessage,
  IWaitingRoomMessage,
  WaitingRoomServerAction,
  WaitingRoomError,
  WaitingRoomAction,
} from "./models/waitingRoom";
import { connectDB } from "./libs/db";
import {
  GameAction,
  GameActionServer,
  GameError,
  IGame,
  IGameServerMessage,
} from "./models/game/types";
import { houseRule } from "./models/houseRule";
import { Card, CardColor, CardDeck, ICard } from "./models/card";
import mongoose from "mongoose";
import { gameFromWaitingRoom, Game } from "./models/game/schema";

// Typescript needs to know that the env variables are defined
declare module "bun" {
  interface Env {
    JWT_SECRET: string;
    DB_URL: string;
    FRONTEND_URL: string;
  }
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
  }
}

connectDB();

let serverInstance: Server | undefined | null;
export const app = new Elysia()
  .use(tUser)
  .use(swagger())
  .use(
    jwt({
      name: "jwtauth",
      secret: process.env.JWT_SECRET,
      schema: t.Object({
        username: t.String(),
        id: t.String(),
      }),
    }),
  )
  .use(
    cors({
      credentials: true,
      origin: process.env.FRONTEND_URL,
      allowedHeaders: "Content-Type",
    }),
  )
  .error("UNAUTHORIZED", AuthError)
  .onError(({ code, error, set }) => {
    switch (code) {
      case "VALIDATION":
        set.status = 400;
        break;
      case "UNAUTHORIZED":
        set.status = 401;
        break;
      case "NOT_FOUND":
        set.status = 404;
        break;
      default:
        set.status = 500;
        break;
    }
    return error.message;
  })
  .group("/user", (app) => {
    return app
      .post(
        "/",
        async ({ jwtauth, body, cookie: { authorization } }) => {
          const user = await encryptUser(body);
          await user.save();

          const token = await jwtauth.sign({
            username: user.username,
            id: user.id,
          });
          authorization.set({
            value: token,
            sameSite: "none",
            path: "/",
            secure: true,
          });
          return "success";
        },
        { body: "user" },
      )
      .post(
        "/login",
        async ({ body, jwtauth, error, cookie: { authorization } }) => {
          const userId = await checkCredentials(body);
          if (userId) {
            const token = await jwtauth.sign({
              username: body.username,
              id: userId,
            });
            authorization.set({
              value: token,
              sameSite: "none",
              path: "/",
              secure: true,
            });
            return "success";
          } else {
            return error(400, "Invalid credentials");
          }
        },
        { body: "user" },
      );
  })
  .resolve(async ({ jwtauth, cookie: { authorization } }) => {
    const user = await jwtauth.verify(authorization.value);
    if (!user) throw new AuthError("Unauthorized");
    const dbUser = User.findById(user.id);
    if (!dbUser) throw new NotFoundError("User not found");

    return { user };
  })
  .group("/room", (app) => {
    return app
      .get("/", async () => {
        return await WaitingRoom.find().populate("host", "username");
      })
      .post("/", async ({ user }) => {
        const waitingRoom = new WaitingRoom({
          host: new mongoose.Types.ObjectId(user.id),
          users: [{ user: new mongoose.Types.ObjectId(user.id) }],
        });
        await waitingRoom.save();
        return waitingRoom.id;
      })
      .get("/:id", async ({ params }) => {
        const room = await WaitingRoom.findById(params.id)
          .populate("host", "username")
          .populate("users.user", "username")
          .lean();
        return room;
      })
      .ws("/:id/ws", {
        params: t.Object({ id: t.String() }),
        body: tWaitingRoomMessage,
        async beforeHandle({ params }) {
          const waitingRoom = await WaitingRoom.findById(params.id);
          if (!waitingRoom) throw new NotFoundError();
        },
        async open(ws) {
          ws.subscribe(ws.data.params.id);
          const waitingRoom = await WaitingRoom.findById(ws.data.params.id);
          if (
            !waitingRoom!.users.some(
              (u) => u.user.toString() === ws.data.user.id,
            )
          ) {
            await WaitingRoom.findByIdAndUpdate(ws.data.params.id, {
              $push: { users: { user: ws.data.user.id } },
            });

            const response: IWaitingRoomServerMessage = {
              action: WaitingRoomServerAction.playerJoined,
              data: ws.data.user.username,
            };
            serverInstance?.publish(
              ws.data.params.id,
              JSON.stringify(response),
            );
          }
        },

        async close(ws) {
          ws.unsubscribe(ws.data.params.id);
          const updated = await WaitingRoom.findByIdAndUpdate(
            ws.data.params.id,
            {
              $pull: { users: { user: ws.data.user.id } },
            },
            { new: true },
          );

          if (updated && updated.users.length == 0) {
            await WaitingRoom.findByIdAndDelete(ws.data.params.id);
            return;
          }

          const playerLeftMessage: IWaitingRoomServerMessage = {
            action: WaitingRoomServerAction.playerLeft,
            data: ws.data.user.username,
          };
          serverInstance?.publish(
            ws.data.params.id,
            JSON.stringify(playerLeftMessage),
          );

          if (updated?.host.toString() == ws.data.user.id) {
            updated.host = updated.users[0].user;
            await updated.save();
            updated.populate<{ host: IUser }>("host", "username").then((d) => {
              const newHostMessage: IWaitingRoomServerMessage = {
                action: WaitingRoomServerAction.newHost,
                data: d.host.username,
              };
              serverInstance?.publish(
                ws.data.params.id,
                JSON.stringify(newHostMessage),
              );
            });
          }
        },

        async message(ws, message) {
          const waitingRoom = await WaitingRoom.findById(ws.data.params.id);
          try {
            switch (message.action) {
              case "start":
                if (waitingRoom!.host.toString() != ws.data.user.id) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.notTheHost,
                    }),
                  );
                }

                if (waitingRoom!.users.length < 2) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.notEnoughPlayers,
                    }),
                  );
                }

                if (waitingRoom!.users.some((u) => !u.ready)) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.notReady,
                    }),
                  );
                }

                if (!waitingRoom!.deck) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.noDeck,
                    }),
                  );
                }

                const game = await gameFromWaitingRoom(waitingRoom!);

                serverInstance?.publish(
                  ws.data.params.id,
                  JSON.stringify(<IWaitingRoomServerMessage>{
                    action: WaitingRoomServerAction.start,
                    data: game.id,
                  }),
                );
                break;

              case "addRule":
                if (waitingRoom!.host.toString() !== ws.data.user.id) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.notTheHost,
                    }),
                  );
                }
                if (
                  !message.data ||
                  typeof message.data !== "string" ||
                  !(Object.values(houseRule) as string[]).includes(message.data)
                )
                  throw new ValidationError(
                    "message.data",
                    t.Enum(houseRule),
                    message.data,
                  );
                if (!waitingRoom!.houseRules.includes(message.data)) {
                  waitingRoom!.houseRules.push(message.data);
                  await waitingRoom!.save();

                  ws.publish(
                    ws.data.params.id,
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.addRule,
                      data: message.data,
                    }),
                  );
                }
                break;
              case "removeRule":
                if (waitingRoom!.host.toString() !== ws.data.user.id) {
                  throw new Error(
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.error,
                      data: WaitingRoomError.notTheHost,
                    }),
                  );
                }

                if (
                  !message.data ||
                  typeof message.data !== "string" ||
                  !(Object.values(houseRule) as string[]).includes(message.data)
                )
                  throw new ValidationError(
                    "message.data",
                    t.Enum(houseRule),
                    message.data,
                  );

                if (waitingRoom!.houseRules.includes(message.data)) {
                  await WaitingRoom.findByIdAndUpdate(ws.data.params.id, {
                    $pull: { houseRules: message.data },
                  });

                  ws.publish(
                    ws.data.params.id,
                    JSON.stringify(<IWaitingRoomServerMessage>{
                      action: WaitingRoomServerAction.removeRule,
                      data: message.data,
                    }),
                  );
                }
                break;

              case "ready":
                if (typeof message.data !== "boolean")
                  throw new ValidationError(
                    "message.data",
                    t.Boolean(),
                    message.data,
                  );
                await WaitingRoom.findOneAndUpdate(
                  {
                    _id: waitingRoom!._id,
                    "users.user": ws.data.user.id,
                  },
                  { $set: { "users.$.ready": message.data } },
                );

                ws.publish(
                  ws.data.params.id,
                  JSON.stringify(<IWaitingRoomServerMessage>{
                    action: WaitingRoomServerAction.ready,
                    data: message.data,
                    user: ws.data.user.username,
                  }),
                );
                break;
              case WaitingRoomAction.setDeck:
                if (!message.data || typeof message.data !== "string")
                  throw new ValidationError(
                    "message.data",
                    t.String(),
                    message.data,
                  );

                waitingRoom!.deck = new mongoose.Types.ObjectId(message.data);
                await waitingRoom!.save();
                serverInstance?.publish(
                  ws.data.params.id,
                  JSON.stringify(<IWaitingRoomServerMessage>{
                    action: WaitingRoomServerAction.setDeck,
                    data: message.data,
                  }),
                );

                break;
              default:
                break;
            }
          } catch (e: any) {
            ws.send(e.message);
          }
        },
      });
  })
  .group("/deck", (app) =>
    app.get("/", async () => {
      const decks = await CardDeck.find();
      return decks;
    }),
  )
  .group("/game", (app) =>
    app
      .get("/", async ({ user }) => {
        const games = await Game.find({
          players: { $elemMatch: { user: user?.id } },
        }).lean();
        return games;
      })
      .get("/:id", async ({ params: { id }, user }) => {
        const game = await Game.findById(id)
          .populate({
            path: "discardPile",
            select: "-_id -__v",
          })
          .populate({
            path: "players",
            match: { user: new mongoose.Types.ObjectId(user.id) },
            populate: {
              path: "hand",
              select: "-_id -__v",
            },
          })
          .populate({
            path: "players",
            populate: {
              path: "user",
              select: "-__v -password",
            },
          })
          .select("-_id -__v -players.accusable")
          .transform((d) => {
            const newPlayers = d?.players.map((p) =>
              p.user.equals(new mongoose.Types.ObjectId(user.id))
                ? p
                : { ...p, hand: { length: p.hand.length } },
            );
            return {
              ...d,
              players: newPlayers,
              drawPile: { length: d?.drawPile.length },
            };
          })
          .lean();
        return game;
      })
      .ws("/:id/ws", {
        body: t.Object({
          action: t.Enum(GameAction),
          data: t.Optional(
            t.Union([t.String(), t.Number(), t.Enum(CardColor), t.Boolean()]),
          ),
        }),
        async open(ws) {
          const game = await Game.findById(ws.data.params.id);
          if (!game) ws.close();

          ws.subscribe(ws.data.params.id);
        },
        async message(ws, message) {
          const game = await Game.findById(ws.data.params.id);
          if (!game) {
            ws.close();
            throw new NotFoundError("Game not found");
          }

          if (game.finished) throw new Error(GameError.gameFinished);

          try {
            switch (message.action) {
              case GameAction.lastCard:
                await game.announceLastCard(ws.data.user.id);
                break;
              case GameAction.accuse:
                if (!message.data || typeof message.data != "string")
                  throw new Error(GameError.invalidAction);
                game.accusePlayer(ws.data.user.id, message.data);
                break;
              case GameAction.answerPrompt:
                await game.handlePlayerPrompt(ws.data.user.id, message.data);

                break;
              case GameAction.playCard:
                if (
                  message.data == undefined ||
                  typeof message.data != "number"
                )
                  throw new ValidationError(
                    "message.data",
                    t.Number(),
                    message.data,
                  );

                await game.requestPlayCard(ws.data.user.id, message.data);
                break;
              case GameAction.drawCard:
                game.requestCardDraw(ws.data.user.id);
                break;
              case GameAction.viewHand:
                const player = game.players.find((p) =>
                  p.user.equals(new mongoose.Types.ObjectId(ws.data.user.id)),
                );

                const cards = await Promise.all(
                  player!.hand.map(
                    async (id) => await Card.findById(id).select("-id -__v"),
                  ),
                );

                ws.send(
                  JSON.stringify(<IGameServerMessage>{
                    action: GameActionServer.viewHand,
                    data: cards,
                  }),
                );
                break;
            }

            if (game?.finished) {
              const winningPlayers = await User.aggregate()
                .match({
                  _id: { $in: game.winningPlayers },
                })
                .addFields({
                  order: { $indexOfArray: [game.winningPlayers, "$_id"] },
                })
                .sort({ order: 1 })
                .project({ username: 1 });

              serverInstance?.publish(
                ws.data.params.id,
                JSON.stringify(<IGameServerMessage>{
                  action: GameActionServer.endGame,
                  data: winningPlayers.map((p) => p.username),
                }),
              );
              await Game.deleteOne({ _id: game._id });
              ws.close();
            }
            await game.save();

            for (const m of game.notifications || []) {
              serverInstance?.publish(ws.data.params.id, JSON.stringify(m));
            }
          } catch (error: any) {
            ws.send(
              JSON.stringify(<IGameServerMessage>{
                action: GameActionServer.error,
                data: error.message,
              }),
            );
          }
        },
      }),
  )
  .listen(3000);

serverInstance = app.server;

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
