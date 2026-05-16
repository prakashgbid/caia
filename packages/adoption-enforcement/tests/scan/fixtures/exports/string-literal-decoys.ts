// Fixture: comments and string literals that look like exports but are not.
// export function shouldBeIgnoredFromComment() {}
/* export class ShouldBeIgnoredFromBlockComment {} */

const decoy1 = 'export function fakeFromString() {}';
const decoy2 = `export const fakeFromTemplate = 1;`;
const decoy3 = "export interface FakeFromDoubleQuoted {}";

// The only real export in this fixture:
export const realOne = decoy1.length + decoy2.length + decoy3.length;
