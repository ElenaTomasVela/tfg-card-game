import mongoose from "mongoose";
import { CardColor, ICard } from "../card";
import { HouseRule, IHouseRuleConfig } from "../houseRule";

export interface IPlayer {
  user: mongoose.Types.ObjectId;
  hand: mongoose.Types.ObjectId[];
  announcingLastCard: boolean;
  accusable: boolean;
}

export enum GameAction {
  lastCard = "lastCard",
  accuse = "accuse",
  answerPrompt = "answerPrompt",
  playCard = "playCard",
  drawCard = "drawCard",
  viewHand = "viewHand",
  chat = "chat",
}

export enum GameActionServer {
  draw = "draw",
  lastCard = "lastCard",
  accuse = "accuse",
  startTurn = "startTurn",
  error = "error",
  changeColor = "changeColor",
  playCard = "playCard",
  viewHand = "viewHand",
  endGame = "endGame",
  requestPrompt = "requestPrompt",
  refreshDeck = "refreshDeck",
  eliminate = "eliminate",
  swapHands = "swapHands",
  chat = "chat",
}

export enum GamePromptType {
  chooseColor = "chooseColor",
  stackDrawCard = "stackDrawCard",
  playDrawnCard = "playDrawnCard",
  choosePlayerToSwitchWith = "choosePlayerToSwitchWith",
}

export enum GameError {
  notPrompted = "notPrompted",
  invalidAction = "invalidAction",
  outOfTurn = "outOfTurn",
  conditionsNotMet = "conditionsNotMet",
  waitingForPrompt = "waitingForPrompt",
  gameFinished = "gameFinished",
  unplayableCard = "unplayableCard",
}

export interface IGamePrompt {
  type: GamePromptType;
  data?: number;
  player?: number;
}

export interface IGame {
  currentPlayer: number;
  promptQueue: IGamePrompt[];
  clockwiseTurns: boolean;
  forcedColor?: CardColor;
  notifications: IGameServerMessage[];
  turnsToSkip: number;
  houseRules: IHouseRuleConfig;
  players: IPlayer[];
  discardPile: mongoose.Types.ObjectId[];
  drawPile: mongoose.Types.ObjectId[];
  eliminatedPlayers: number[];
  finished: boolean;
}

export interface IGameMethods {
  announceLastCard(userId: string): Promise<void>;
  nextPlayerIndex(index: number, reverse?: boolean): number;
  accusePlayer(accuserId: string, accusedId: string): void;
  isCardPlayable(cardId: mongoose.Types.ObjectId): Promise<boolean>;
  isCounterPossible(): boolean;
  isAbleToInterject(cardId: mongoose.Types.ObjectId): Promise<boolean>;
  playCard(
    playerIndex: number,
    index: number,
    triggerEffect?: boolean,
  ): Promise<ICard>;
  requestPlayCard(userId: string, index: number): Promise<void>;
  canAnnounceLastCard(userId: string): Promise<boolean>;
  nextTurn(): void;
  drawCard(playerIndex: number, quantity: number): Promise<void>;
  handlePlayerPrompt(
    userId: string,
    answer?: string | number | CardColor | boolean,
  ): Promise<void>;
  requestCardDraw(userId: string): void;
  handleCardEffect(cardId: mongoose.Types.ObjectId): Promise<void>;
  pushNotification(notification: IGameServerMessage): void;
  endGame(): Promise<void>;
  eliminatePlayer(playerIndex: number): Promise<void>;
}

export interface IGameMessage {
  action: GameAction;
  data?: string | number | boolean;
}

export interface IGameServerMessage {
  action: GameActionServer;
  data?: any;
  user?: string;
}
