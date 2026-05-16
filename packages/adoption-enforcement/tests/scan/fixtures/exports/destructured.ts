// Fixture: destructured `export const { a, b } = ...`.
const src = { a: 1, b: 2, c: 3 };
export const { a, b } = src;
export const [first, , third] = [10, 20, 30];
