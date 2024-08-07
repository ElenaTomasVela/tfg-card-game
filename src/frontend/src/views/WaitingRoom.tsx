import { H1, H2 } from "@/components/Headings";
import { Switch } from "@/components/ui/switch";
import { ReactNode, useContext, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { Button } from "@/components/ui/button";
import { api, waitForSocketConnection } from "@/lib/utils";
import { useNavigate, useParams } from "react-router-dom";
import {
  HouseRule,
  IWaitingRoom,
  ICardDeck,
  IWaitingRoomMessage,
  WaitingRoomAction,
  IWaitingRoomServerMessage,
  WaitingRoomServerAction,
  IHouseRuleConfig,
  HouseRuleName,
  StackDrawHouseRule,
  DrawHouseRule,
  EndConditionHouseRule,
  HouseRuleDetails,
} from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AuthContext, AuthContextType } from "@/context/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem } from "@/components/ui/command";
import { CommandList } from "cmdk";
import { Separator } from "@/components/ui/separator";
import ClipboardButton from "@/components/ui/clipboard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import Chat from "@/components/Chat";

const Player = ({
  player,
}: {
  player: { user: { username: string }; ready?: boolean };
}) => {
  return (
    <>
      <span className="flex gap-2 justify-between">
        <span className="flex items-center gap-2">
          <Icon icon="ic:sharp-person" className="size-10" />
          <span className="text-lg">{player.user.username}</span>
        </span>
        <span
          className={`${player.ready ? "bg-primary/30" : "bg-accent/30"} py-1 px-2 rounded-full h-fit my-auto whitespace-nowrap`}
        >
          {player.ready ? "Ready" : "Not ready"}
        </span>
      </span>
    </>
  );
};

const HouseRuleSwitch = ({
  houseRule,
  disable,
  checked,
  onChange,
}: {
  houseRule: { name: string; description: string; id: string };
  disable: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) => {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="col-span-2 flex justify-between items-center gap-3">
            <label
              className={`${!disable && "cursor-pointer"} select-none`}
              htmlFor={houseRule.id}
            >
              {houseRule.name}
            </label>
            <Switch
              className="shadow-inner my-auto"
              id={houseRule.id}
              disabled={disable}
              checked={checked}
              onCheckedChange={onChange}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p>{houseRule.description}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
};

const DeckSelect = ({
  deck,
  checked,
  onChange,
  disabled,
}: {
  deck: ICardDeck;
  checked: boolean;
  disabled: boolean;
  onChange: (id: string) => void;
}) => {
  return (
    <>
      <input
        name="deck"
        className="hidden peer"
        type="radio"
        id={`deck${deck._id}`}
        value={deck._id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <Label
        htmlFor={`deck${deck._id}`}
        className="group focus:outline-none rounded-xl transition-all
        peer-checked:shadow-primary/10 peer-checked:shadow-xl peer-checked:border-primary/40
        "
      >
        <Card className="p-3 flex flex-col text-center border-inherit min-w-fit">
          <CardTitle
            className={`text-lg font-semibold transition-all ${checked ? "text-primary-dark" : "text-gray-500 "}`}
          >
            {deck.name}
          </CardTitle>
          <span className="text-gray-700 text-sm">{deck.description}</span>
        </Card>
      </Label>
    </>
  );
};

function HouseRuleSelect({
  options,
  value,
  onChange,
  disable,
  label,
  noneOption,
  children,
}: {
  options: string[];
  value: string | undefined;
  label: string;
  onChange: (option: string | null) => void;
  noneOption?: boolean;
  children?: ReactNode;
  disable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Label
          htmlFor={label}
          className={`text-base select-none font-normal my-auto ${disable && "pointer-events-none"}`}
        >
          {label}
        </Label>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="justify-between group"
            size="sm"
            id={label}
            disabled={disable}
          >
            {(value &&
              HouseRuleName[
                value as
                  | EndConditionHouseRule
                  | DrawHouseRule
                  | StackDrawHouseRule
              ]) ||
              "None"}
            <Icon
              icon="lucide:chevron-right"
              className="group-radix-state-open:rotate-90 transition-all"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-2 w-fit">
          <div className="flex gap-2">
            <Command className="w-fit">
              <CommandList className="">
                {noneOption && (
                  <CommandItem
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                  >
                    None
                  </CommandItem>
                )}
                {options.map((option, index) => (
                  <CommandItem
                    key={index}
                    value={option}
                    onSelect={(v) => {
                      onChange(v);
                      setOpen(false);
                    }}
                  >
                    {HouseRuleName[option] || "None"}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            <div>
              <Separator orientation="vertical" />
            </div>
            <div className="px-1 text-sm w-80 flex flex-col gap-2">
              {children}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export const WaitingRoom = () => {
  const { user } = useContext(AuthContext) as AuthContextType;
  const [room, setRoom] = useState<IWaitingRoom>();
  const [decks, setDecks] = useState<ICardDeck[]>([]);
  const [socket, setSocket] = useState<WebSocket>();
  const { roomId } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const setPlayerReady = (player: string, ready: boolean) => {
    setRoom((r) => {
      if (!r) return;
      const newPlayers = r.users.map((u) =>
        u.user.username == player ? { ...u, ready: ready } : u,
      );
      return {
        ...r,
        users: newPlayers,
      };
    });
  };

  const addPlayer = (player: string) => {
    setRoom((r) => {
      if (!r) return;
      return {
        ...r,
        users: [
          ...r!.users,
          {
            user: { username: player },
            ready: false,
          },
        ],
      };
    });
  };

  const setHouseRuleConfig = (config: IHouseRuleConfig) => {
    setRoom((r) => {
      if (!r) return;
      return { ...r, houseRules: Object.assign(r.houseRules, config) };
    });
  };

  const addHouseRule = (rule: HouseRule) => {
    setRoom((r) => {
      if (!r) return;
      const newHouseRules: IHouseRuleConfig = {
        ...r.houseRules,
        generalRules: [...r.houseRules.generalRules, rule],
      };
      return {
        ...r,
        houseRules: newHouseRules,
      };
    });
  };

  const removeHouseRule = (rule: HouseRule) => {
    setRoom((r) => {
      if (!r) return;
      const newHouseRules: IHouseRuleConfig = {
        ...r.houseRules,
        generalRules: r.houseRules.generalRules.filter((hr) => hr !== rule),
      };
      return {
        ...r,
        houseRules: newHouseRules,
      };
    });
  };

  const chooseDeck = (deckId: string) => {
    setRoom((r) => {
      if (!r) return;
      return {
        ...r,
        deck: deckId,
      };
    });
  };

  const connect = async () => {
    const fetchedRoom = await api.get("/room/" + roomId);
    setRoom(fetchedRoom.data);

    const webSocket = new WebSocket(
      `${import.meta.env.VITE_BACKEND_WS_URL}/room/${fetchedRoom.data._id}/ws`,
    );
    await waitForSocketConnection(webSocket);
    toast({ description: "Successfully connected to the room" });
    webSocket.addEventListener("message", (message) => {
      if (message.data === "success") return;
      const msgObject: IWaitingRoomServerMessage = JSON.parse(message.data);
      switch (msgObject.action) {
        case "playerJoined":
          if (typeof msgObject.data !== "string") return;
          addPlayer(msgObject.data);
          break;
        case "playerLeft":
          setRoom((r) => {
            if (!r) return;
            const newPlayers = r?.users.filter(
              (u) => u.user.username != msgObject.data,
            );
            return {
              ...r,
              users: newPlayers,
            };
          });
          break;
        case WaitingRoomServerAction.start:
          navigate("/game/" + msgObject.data);
          break;
        case WaitingRoomServerAction.ready:
          if (typeof msgObject.data !== "boolean") return;
          setPlayerReady(msgObject.user!, msgObject.data);
          break;
        case "addRule":
          if (typeof msgObject.data !== "string") return;
          addHouseRule(msgObject.data as HouseRule);
          break;
        case "removeRule":
          if (typeof msgObject.data !== "string") return;
          removeHouseRule(msgObject.data as HouseRule);
          break;
        case WaitingRoomServerAction.setDeck:
          if (typeof msgObject.data !== "string") return;
          chooseDeck(msgObject.data);
          break;
        case WaitingRoomServerAction.setRule:
          if (typeof msgObject.data !== "object") return;
          setHouseRuleConfig(msgObject.data);
          break;
        case WaitingRoomServerAction.newHost:
          if (msgObject.data === null || typeof msgObject.data !== "string")
            return;
          setRoom((r) => {
            if (!r) return;
            return { ...r, host: { username: msgObject.data as string } };
          });
          break;
        case WaitingRoomServerAction.error:
        default:
          break;
      }
    });
    setSocket(webSocket);
    return webSocket;
  };

  useEffect(() => {
    const fetchDecks = async () => {
      const response = await api.get<ICardDeck[]>("/deck");
      setDecks(response.data);
    };
    const ws = connect();
    fetchDecks();

    return () => {
      ws.then((ws) => ws.close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getReady = async (ready: boolean) => {
    if (!socket || !user) return;
    socket?.send(JSON.stringify({ action: "ready", data: ready }));
    setPlayerReady(user, ready);
  };

  const changeHouseRule = async (id: HouseRule, add: boolean) => {
    if (!socket || !user) return;
    if (add) {
      socket?.send(JSON.stringify({ action: "addRule", data: id }));
      addHouseRule(id);
    } else {
      socket?.send(JSON.stringify({ action: "removeRule", data: id }));
      removeHouseRule(id);
    }
  };

  const changeHouseRuleConfig = (category: string, value: string | null) => {
    if (!socket || !user) return;
    socket.send(
      JSON.stringify({
        action: WaitingRoomAction.setRule,
        data: { [category]: value },
      }),
    );
  };

  const changeDeck = async (id: string) => {
    if (!socket || !user) return;
    socket.send(
      JSON.stringify({
        action: WaitingRoomAction.setDeck,
        data: id,
      } as IWaitingRoomMessage),
    );
  };

  const sendChatMessage = async (message: string) => {
    socket?.send(
      JSON.stringify({
        action: WaitingRoomAction.chat,
        data: message,
      } as IWaitingRoomMessage),
    );
  };

  const startGame = () => {
    if (!socket || !user) return;

    if (room?.deck == null) {
      toast({ description: "You cannot start a game without a deck!" });
      return;
    }

    if (room.users.length < 2) {
      toast({ description: "You need at least 2 players to start a game!" });
    }

    if (room.users.length > 15) {
      toast({ description: "You can't have more than 15 players in a game!" });
    }

    if (room.users.some((u) => !u.ready)) {
      toast({ description: "All players must be ready to start the game!" });
    }
    socket.send(JSON.stringify({ action: "start" }));
  };

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex gap-5 items-center">
          <H1>Waiting Room</H1>
          <ClipboardButton toCopy={location.href} />
        </div>
        <div className="flex flex-col lg:flex-row gap-10 justify-between flex-wrap">
          <Collapsible
            className="flex-1 flex flex-col shrink-0 overflow-hidden"
            defaultOpen={true}
          >
            <CollapsibleTrigger className="group flex items-center gap-5 bg-white z-10 border-b pb-3">
              <H2 className="font-normal">Current Players</H2>
              <Icon
                className="group-radix-state-open:rotate-90 size-5 transition-all"
                icon="lucide:chevron-right"
              />
            </CollapsibleTrigger>
            <CollapsibleContent
              className="relative flex-1 overflow-auto lg:h-full animate-in slide-in-from-top
              radix-state-closed:animate-out radix-state-closed:slide-out-to-top border rounded-b-xl
              border-t-0"
            >
              <div className="lg:absolute size-full flex flex-col pr-5 p-2">
                {room?.users &&
                  room.users.map((p, index) => (
                    <Player player={p} key={index} />
                  ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="lg:flex justify-between flex-wrap flex-1 basis-2/5 gap-5">
            <div className="">
              <H2 className="font-normal">Choose your House Rules</H2>
              <div className="grid gap-3 md:px-5 py-3 grid-cols-2 w-full">
                <div className="grid grid-cols-subgrid col-span-2 gap-2 overflow:hidden">
                  <HouseRuleSelect
                    disable={room?.host.username !== user}
                    noneOption
                    label="Draw Card stacking"
                    value={room?.houseRules.drawCardStacking}
                    options={Object.values(StackDrawHouseRule)}
                    onChange={(value) =>
                      changeHouseRuleConfig("drawCardStacking", value)
                    }
                  >
                    <p>
                      Allow countering a Draw card by playing another Draw Card,
                      combining its values against the next player.
                    </p>
                    <p>
                      <strong>All:</strong> All Draw cards may be used to
                      counter.
                    </p>
                    <p>
                      <strong>Flat:</strong> Only Draw cards of same value may
                      be used to counter.
                    </p>
                    <p>
                      <strong>Progressive:</strong> Only Draw Cards of equal or
                      higher value may be used to counter
                    </p>
                  </HouseRuleSelect>
                  <HouseRuleSelect
                    disable={room?.host.username !== user}
                    noneOption
                    label="Draw punishment"
                    value={room?.houseRules.draw}
                    options={Object.values(DrawHouseRule)}
                    onChange={(value) => changeHouseRuleConfig("draw", value)}
                  >
                    <p>Punishment when not playing a drawn card.</p>
                    <p>
                      <strong>Extra Card:</strong> One more card is drawn before
                      the turn ends.
                    </p>
                    <p>
                      <strong>Draw until play:</strong> The player must draw
                      until they can play a card.
                    </p>
                  </HouseRuleSelect>
                  <HouseRuleSelect
                    disable={room?.host.username !== user}
                    label="Game ending condition"
                    value={room?.houseRules.endCondition}
                    options={Object.values(EndConditionHouseRule)}
                    onChange={(value) =>
                      changeHouseRuleConfig("endCondition", value)
                    }
                  >
                    <p>
                      <strong>One player left:</strong> The game continues until
                      only 1 player has any cards in hand.
                    </p>
                    <p>
                      <strong>Score:</strong> The game ends as soon as a player
                      has no cards. The rest of players are ranked from lowest
                      to highest score.
                    </p>
                    <p>
                      <strong>Score, mercy:</strong> Same as Score, but players
                      with 25 cards or more are eliminated from the game.
                    </p>
                  </HouseRuleSelect>
                  <Separator className="col-span-2 my-4" />
                  <div className="col-span-2 w-full grid-cols-4 grid gap-3">
                    {Object.values(HouseRule).map((hr) => (
                      <HouseRuleSwitch
                        key={hr as string}
                        disable={room?.host.username !== user}
                        houseRule={HouseRuleDetails[hr]}
                        checked={room?.houseRules.generalRules.includes(hr)}
                        onChange={(checked) => changeHouseRule(hr, checked)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 flex-1">
              <H2 className="font-normal">Choose your Deck</H2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {decks &&
                  decks.map((d) => (
                    <DeckSelect
                      deck={d}
                      key={d._id}
                      onChange={changeDeck}
                      checked={room?.deck == d._id}
                      disabled={user != room?.host?.username}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
        <span className="flex flex-col items-center gap-3">
          <span className="flex items-center gap-3">
            <Switch id="ready" onCheckedChange={getReady} />
            <label htmlFor="ready" className="cursor-pointer select-none">
              I'm ready
            </label>
          </span>
          {user == room?.host?.username && (
            <Button onClick={() => startGame()}>Start Game</Button>
          )}
        </span>
      </div>
      {socket && (
        <Chat<IWaitingRoomServerMessage>
          socket={socket}
          onSend={sendChatMessage}
          messageMatcher={(m) => m.action === WaitingRoomServerAction.chat}
          parserFunction={(m) => JSON.parse(m)}
          dataExtractFunction={(m) => ({
            message: m.data as string,
            senderName: m.user as string,
          })}
        />
      )}
    </>
  );
};
