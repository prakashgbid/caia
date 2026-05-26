// @vitest-environment node
// Compile-time smoke tests for @caia/ui — confirms the public surface exists
// and the variant types are wired. Full DOM tests live in apps once
// @testing-library/react is in the dev dep tree.

import { describe, expect, it } from "vitest";
import * as ui from "../src/index.js";

describe("@caia/ui — public surface", () => {
  it("exports Button + Card + Input + Badge + Progress", () => {
    expect(typeof ui.Button).toBe("object"); // forwardRef => object
    expect(typeof ui.Card).toBe("object");
    expect(typeof ui.Input).toBe("object");
    expect(typeof ui.Badge).toBe("function"); // plain functional
    expect(typeof ui.Progress).toBe("object");
  });

  it("exports Accordion family", () => {
    expect(typeof ui.Accordion).toBe("object");
    expect(typeof ui.AccordionItem).toBe("object");
    expect(typeof ui.AccordionTrigger).toBe("object");
    expect(typeof ui.AccordionContent).toBe("object");
  });

  it("exports Dialog family", () => {
    expect(typeof ui.Dialog).toBe("function");
    expect(typeof ui.DialogTrigger).toBe("object");
    expect(typeof ui.DialogContent).toBe("object");
    expect(typeof ui.DialogTitle).toBe("object");
  });

  it("exports Sheet family", () => {
    expect(typeof ui.Sheet).toBe("function");
    expect(typeof ui.SheetTrigger).toBe("object");
    expect(typeof ui.SheetContent).toBe("object");
  });

  it("exports ScrollArea + Tabs family", () => {
    expect(typeof ui.ScrollArea).toBe("object");
    expect(typeof ui.Tabs).toBe("function");
    expect(typeof ui.TabsList).toBe("object");
    expect(typeof ui.TabsTrigger).toBe("object");
    expect(typeof ui.TabsContent).toBe("object");
  });

  it("exports Form primitives + cn helper", () => {
    expect(typeof ui.Label).toBe("object");
    expect(typeof ui.FormField).toBe("object");
    expect(typeof ui.FormDescription).toBe("object");
    expect(typeof ui.FormErrorMessage).toBe("object");
    expect(typeof ui.cn).toBe("function");
  });

  it("buttonVariants returns a string for default invocation", () => {
    const classes = ui.buttonVariants({});
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("cn merges tailwind classes (last wins)", () => {
    expect(ui.cn("p-2", "p-4")).toBe("p-4");
    expect(ui.cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("cn handles falsy + array inputs", () => {
    expect(ui.cn("foo", false && "bar", null, undefined, "baz")).toBe("foo baz");
    expect(ui.cn(["foo", "bar"])).toBe("foo bar");
  });
});
