-- Tokenizer must not be confused by semicolons inside comments and strings.
-- A semicolon inside a -- line comment; should be ignored.
/* Block comment with a ; inside it; ignored. */
CREATE TABLE thing (
  id TEXT PRIMARY KEY,
  description TEXT DEFAULT 'a string with ; inside it; still one statement',
  identifier TEXT DEFAULT "quoted ""identifier"" with ; inside; still ignored"
);
