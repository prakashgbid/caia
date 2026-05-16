// Fixture: simple declaration exports.
export function helloFn(): void {}
export class HelloClass {}
export const HELLO_CONST = 1;
export let helloLet = 2;
export var helloVar = 3;
export interface HelloShape {
  readonly id: string;
}
export type HelloAlias = HelloShape['id'];
export enum HelloEnum {
  A,
  B,
}
