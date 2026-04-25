export const CONTENT_TYPES = {
  'forum-thread':      { label: 'Forum Thread',      smeOnly: false, minLength: 80,   maxLength: 800,  pokerOnly: false, rouletteOnly: false },
  'reply':             { label: 'Reply',              smeOnly: false, minLength: 30,   maxLength: 400,  pokerOnly: false, rouletteOnly: false },
  'hand-review':       { label: 'Hand Review',        smeOnly: false, minLength: 150,  maxLength: 600,  pokerOnly: true,  rouletteOnly: false },
  'spin-analysis':     { label: 'Spin Analysis',      smeOnly: false, minLength: 150,  maxLength: 600,  pokerOnly: false, rouletteOnly: true  },
  'poll':              { label: 'Poll',               smeOnly: false, minLength: 20,   maxLength: 200,  pokerOnly: false, rouletteOnly: false },
  'tip':               { label: 'Quick Tip',          smeOnly: false, minLength: 40,   maxLength: 300,  pokerOnly: false, rouletteOnly: false },
  'meetup':            { label: 'Meetup Post',        smeOnly: false, minLength: 60,   maxLength: 400,  pokerOnly: false, rouletteOnly: false },
  'venue-review':      { label: 'Venue Review',       smeOnly: false, minLength: 100,  maxLength: 500,  pokerOnly: false, rouletteOnly: false },
  'tournament-recap':  { label: 'Tournament Recap',   smeOnly: false, minLength: 120,  maxLength: 600,  pokerOnly: false, rouletteOnly: false },
  'welcome-intro':     { label: 'Welcome Intro',      smeOnly: false, minLength: 60,   maxLength: 300,  pokerOnly: false, rouletteOnly: false },
  'reaction':          { label: 'Reaction',           smeOnly: false, minLength: 20,   maxLength: 200,  pokerOnly: false, rouletteOnly: false },
  'article':           { label: 'Article',            smeOnly: true,  minLength: 800,  maxLength: 4000, pokerOnly: false, rouletteOnly: false },
  'research-paper':    { label: 'Research Paper',     smeOnly: true,  minLength: 1000, maxLength: 6000, pokerOnly: false, rouletteOnly: false },
  'interview':         { label: 'Interview',          smeOnly: true,  minLength: 600,  maxLength: 3000, pokerOnly: false, rouletteOnly: false },
  'editorial-pick':    { label: 'Editorial Pick',     smeOnly: true,  minLength: 200,  maxLength: 1000, pokerOnly: false, rouletteOnly: false },
  'quarterly-report':  { label: 'Quarterly Report',   smeOnly: true,  minLength: 800,  maxLength: 5000, pokerOnly: false, rouletteOnly: false },
} as const;

export type ContentTypeKey = keyof typeof CONTENT_TYPES;
