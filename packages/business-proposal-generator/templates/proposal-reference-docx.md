# Reference docx notes

The Markdown-to-DOCX conversion uses `pandoc --reference-doc=<path>`.

For V1 we do not ship a binary reference docx in the package. The
`convertMarkdownToDocx` function omits `--reference-doc` if no path is
passed, letting pandoc use its built-in default Word style.

To ship a branded reference docx later: create it in Word with the
desired heading + body styles, save as `proposal-reference.docx` in this
folder, then pass `referenceDocxPath: join(templatesRoot, 'proposal-reference.docx')`
when calling `convertMarkdownToDocx`.
