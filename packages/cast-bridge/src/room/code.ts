// No ambiguous characters: exclude O (looks like 0), I (looks like 1/l), L (looks like 1/I)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRoomCode(): string {
  const segment = (len: number): string =>
    Array.from(
      { length: len },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)] as string
    ).join('');
  return `${segment(4)}-${segment(4)}`;
}
