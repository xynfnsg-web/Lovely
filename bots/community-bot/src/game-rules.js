import { randomInt } from "node:crypto";

export const MAX_WAGER = 1000;
const reels = ["CHERRY", "LEMON", "BELL", "STAR", "SEVEN"];
const redNumbers = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function parseWager(value) {
  if (!/^[1-9]\d{0,3}$/.test(value || "")) return null;
  const stake = Number(value);
  return stake <= MAX_WAGER ? stake : null;
}

// Multipliers are TOTAL returns, including the original stake.
export function playGame(game, choice, roll = randomInt) {
  if (game === "slots") {
    const result = Array.from({ length: 3 }, () => reels[roll(reels.length)]);
    const distinct = new Set(result).size;
    return { detail: result.join(" | "), multiplier: distinct === 1 ? 10 : distinct === 2 ? 1 : 0 };
  }
  if (game === "dice") {
    if (!/^[1-6]$/.test(choice || "")) throw new Error("Choose a number from 1 to 6.");
    const result = roll(6) + 1;
    return { detail: `You chose ${choice}. The die rolled ${result}.`, multiplier: result === Number(choice) ? 5 : 0 };
  }
  if (game === "roulette") {
    const validNumber = /^(?:[0-9]|[12][0-9]|3[0-6])$/.test(choice || "");
    if (!validNumber && choice !== "red" && choice !== "black") {
      throw new Error("Choose red, black, or a number from 0 to 36.");
    }
    const result = roll(37);
    const color = result === 0 ? "green" : redNumbers.has(result) ? "red" : "black";
    const won = validNumber ? result === Number(choice) : color === choice;
    return { detail: `You chose ${choice}. The wheel landed on ${result} (${color}).`, multiplier: won ? validNumber ? 36 : 2 : 0 };
  }
  throw new Error("Unknown game.");
}
