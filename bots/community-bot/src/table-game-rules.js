import { randomInt } from "node:crypto";

function shuffle(values, random = randomInt) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const card of cards) {
    const rank = card % 13 + 1;
    total += rank === 1 ? 11 : Math.min(rank, 10);
    if (rank === 1) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function cardLabel(card) {
  return `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card % 13]}${["♠", "♥", "♦", "♣"][Math.floor(card / 13)]}`;
}

export function minesReturn(stake, mines, revealed) {
  if (!revealed) return stake;
  // Exact rational arithmetic avoids losing a point to floating-point rounding.
  let numerator = BigInt(stake) * 97n, denominator = 100n;
  for (let i = 0; i < revealed; i++) {
    numerator *= BigInt(16 - i);
    denominator *= BigInt(16 - mines - i);
  }
  return Number(numerator / denominator);
}

function stand(state, stake) {
  while (handValue(state.dealer) < 17) state.dealer.push(state.deck.pop());
  const player = handValue(state.player), dealer = handValue(state.dealer);
  state.done = true;
  state.payout = dealer > 21 || player > dealer ? stake * 2 : player === dealer ? stake : 0;
  state.result = dealer > 21 ? "Dealer busts. You win." : player > dealer
    ? "You win." : player === dealer ? "Push: stake returned." : "Dealer wins.";
  return state;
}

export function newTableGame(game, stake, mineCount = 3, random = randomInt) {
  if (game === "mines") {
    return { mines: shuffle(Array.from({ length: 16 }, (_, i) => i), random).slice(0, mineCount), revealed: [], done: false };
  }
  if (game !== "blackjack") throw new Error("Unknown table game.");
  const deck = shuffle(Array.from({ length: 52 }, (_, i) => i), random);
  const state = { deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], done: false };
  const player = handValue(state.player), dealer = handValue(state.dealer);
  if (player === 21 || dealer === 21) {
    state.done = true;
    state.payout = player === dealer ? stake : player === 21 ? Math.floor(stake * 2.5) : 0;
    state.result = player === dealer ? "Both have blackjack: push." : player === 21 ? "Blackjack! Pays 3:2." : "Dealer has blackjack.";
  }
  return state;
}

export function advanceTableGame(game, input, action, stake, expired = false) {
  const state = structuredClone(input);
  if (state.done) return state;
  if (game === "mines") {
    if (expired || action === "cashout") {
      if (!expired && state.revealed.length === 0) throw new Error("Reveal a safe tile before collecting.");
      state.done = true;
      state.payout = minesReturn(stake, state.mines.length, state.revealed.length);
      state.result = expired
        ? state.revealed.length ? "Time expired: safe-tile return collected automatically." : "Time expired: untouched stake returned."
        : "Safe-tile return collected.";
      return state;
    }
    if (!/^(?:[0-9]|1[0-5])$/.test(action)) throw new Error("Invalid tile.");
    const tile = Number(action);
    if (state.revealed.includes(tile)) throw new Error("That tile is already revealed.");
    if (state.mines.includes(tile)) {
      state.done = true; state.payout = 0; state.hit = tile;
      state.result = "You hit a mine. This round's stake was lost.";
    } else {
      state.revealed.push(tile);
      if (state.revealed.length === 16 - state.mines.length) {
        state.done = true;
        state.payout = minesReturn(stake, state.mines.length, state.revealed.length);
        state.result = "Every safe tile cleared. Return collected automatically.";
      }
    }
    return state;
  }
  if (game !== "blackjack") throw new Error("Unknown table game.");
  if (expired || action === "stand") {
    const finished = stand(state, stake);
    if (expired) finished.result = `Time expired: automatically stood. ${finished.result}`;
    return finished;
  }
  if (action !== "hit") throw new Error("Invalid blackjack action.");
  state.player.push(state.deck.pop());
  if (handValue(state.player) > 21) {
    state.done = true; state.payout = 0; state.result = "You bust. Dealer wins.";
  } else if (handValue(state.player) === 21) stand(state, stake);
  return state;
}
