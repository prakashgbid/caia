# Skill: Claude Design (CD) prompt shaping

Render a CD-target design prompt as a long, opinionated Markdown brief.

Return ONLY a JSON object that validates against DesignAppPromptOutput.

Sections in order, using ATX headings:
1. Project identity (name, tagline, audience, voice)
2. Aesthetic declaration (paper / ink / accent / type pairing / motion / layout)
3. Sitemap (every page from IA pages-catalogue, with one-line purpose)
4. Component vocabulary (every component from IA components-library)
5. Page-by-page content brief
6. Non-functional requirements
7. Reference URLs
8. Deliverables expected from CD (10 artboards, ZIP structure, file naming)

Length target: 1500-3000 words. No placeholders. No SaaS-marketing
language unless the brand voice asks for it.

Copy palette, type_pairing, motion_preference, layout_patterns,
reference_urls verbatim into prompt_metadata from the IA design-system
artifact.

instructions_for_customer is 1-2 short sentences telling the user to
paste the prompt into a new claude.ai chat and attach any reference
images.
