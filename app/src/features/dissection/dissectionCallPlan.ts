const MAX_CHUNK_CHARACTERS = 2000;
const MAX_TOTAL_CALLS = 6;
const MAX_CHUNKS = 16;

export type DissectionCallPlan = {
  version: 2;
  chunkCount: number;
  minimumCalls: number;
  maximumCalls: number;
  eligible: boolean;
};

export function buildDissectionCallPlan(transcript: string): DissectionCallPlan {
  const chunkCount = transcript.trim() ? countChunks(transcript) : 0;
  return {
    version: 2,
    chunkCount,
    minimumCalls: 1,
    maximumCalls: MAX_TOTAL_CALLS,
    eligible: chunkCount > 0 && chunkCount <= MAX_CHUNKS,
  };
}

function countChunks(transcript: string): number {
  const characters = Array.from(transcript);
  let start = 0;
  let count = 0;
  while (start < characters.length) {
    const hardEnd = Math.min(start + MAX_CHUNK_CHARACTERS, characters.length);
    if (hardEnd === characters.length) {
      count += 1;
      break;
    }
    const paragraphEnd = findLastParagraphEnd(characters, start, hardEnd);
    const sentenceEnd = findLastCharacter(characters, "\u3002", start, hardEnd);
    const end = paragraphEnd >= start
      ? paragraphEnd + 2
      : sentenceEnd >= start
        ? sentenceEnd + 1
        : hardEnd;
    count += 1;
    start = end;
  }
  return count;
}

function findLastParagraphEnd(
  characters: string[],
  start: number,
  hardEnd: number,
): number {
  for (let index = hardEnd - 2; index >= start; index -= 1) {
    if (characters[index] === "\n" && characters[index + 1] === "\n") {
      return index;
    }
  }
  return -1;
}

function findLastCharacter(
  characters: string[],
  target: string,
  start: number,
  hardEnd: number,
): number {
  for (let index = hardEnd - 1; index >= start; index -= 1) {
    if (characters[index] === target) {
      return index;
    }
  }
  return -1;
}
