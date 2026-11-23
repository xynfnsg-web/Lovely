// Resolve only an explicit roast request, never an unrelated member mention.
// Do not send the target's ID, name, profile or alleged vulnerabilities to AI.
export function prepareRoastRequest(text, authorId) {
  const match = /^(?:(?:hey|yo|please|can you|can u|could you|would you)\s+)*(?:roast|cook)\s+<@!?(\d{17,20})>/i.exec(text.trim());
  if (!match) return null;
  const rest = text.trim().slice(match[0].length);
  if (/\b(?:how|what|why|where|when|who|which|explain|help|teach|show me|tell me|do you|is there)\b/i.test(rest)) return null;
  if (/<@!?\d{17,20}>/.test(rest)) return { error: "multiple" };
  const targetId = match[1];
  const kind = targetId === authorId ? "self" : "member";
  return {
    targetId, kind,
    text: kind === "self" ? "Roast me." : text.trim().replace(/<@!?\d{17,20}>/g, "the mentioned member"),
    prefix: kind === "member" ? `<@${targetId}> ` : "",
  };
}
