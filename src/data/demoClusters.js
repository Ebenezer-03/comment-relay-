// Fallback labels for a video's topPackId when it doesn't match any of the
// creator's current categories (e.g. a category was renamed/deleted after
// the video was last synced). src/pages/ConnectedVideos.jsx.
export const PACK_LABELS = { install: 'Install error', env: 'Environment setup', praise: 'Positive feedback', other: 'Needs review' }

// Shown when no Google account is connected, so the app is still explorable
// without live data. src/pages/ReplyDesk.jsx.
export const demoClusters = [
  {
    id: 'install', label: 'Install error', count: 4, priority: 'High', tone: 'coral', summary: 'Viewers are blocked installing the MCP SDK.',
    draft: 'Hey! The package name has changed slightly since I recorded this. Run `npm install @modelcontextprotocol/sdk` and make sure you’re on Node 18 or newer. That should get you unstuck — let me know how it goes.',
    context: 'Node 18+ is required. The current install command is npm install @modelcontextprotocol/sdk. Keep replies practical and warm.',
    comments: [
      { id: 1, name: 'Priya N.', initials: 'PN', time: '12 min ago', text: 'getting an error when i run npm install, says package not found. is the command in the video outdated?', likes: 2 },
      { id: 2, name: 'Marcus Lee', initials: 'ML', time: '38 min ago', text: 'I followed every step but npm cannot find the mcp sdk package. Please help!', likes: 1 },
      { id: 3, name: 'Eli B.', initials: 'EB', time: '1 hr ago', text: 'Does this work with Node 16? install is failing for me.', likes: 0 },
      { id: 4, name: 'Sofia T.', initials: 'ST', time: '2 hr ago', text: 'package install error at 04:12 — would love an updated command', likes: 3 },
    ]
  },
  {
    id: 'env', label: 'Environment setup', count: 3, priority: 'Medium', tone: 'amber', summary: 'The API key setup step needs more context.',
    draft: 'The API key goes in a `.env` file at the root of the project. Name the variable `OPENAI_API_KEY`, then restart the dev server so it can load the new value.',
    context: '',
    comments: [
      { id: 5, name: 'Jules K.', initials: 'JK', time: '3 hr ago', text: 'where exactly do i put the API key? I don’t see that part in the repo.', likes: 4 },
      { id: 6, name: 'Ari Chen', initials: 'AC', time: '4 hr ago', text: 'My key is not being picked up. Do I need to restart something?', likes: 2 },
      { id: 7, name: 'Nikhil R.', initials: 'NR', time: '5 hr ago', text: 'Can you show the .env file setup in a follow-up?', likes: 1 },
    ]
  },
  {
    id: 'praise', label: 'Positive feedback', count: 6, priority: 'Low', tone: 'green', summary: 'Viewers are celebrating the clear walkthrough.',
    draft: 'Thanks for watching — glad the walkthrough helped! If you build something with it, I’d love to see what you make.',
    context: '',
    comments: [
      { id: 8, name: 'Maya R.', initials: 'MR', time: '6 hr ago', text: 'This is the clearest explanation of MCP servers I’ve seen. Thank you!', likes: 12 },
      { id: 9, name: 'Theo G.', initials: 'TG', time: '7 hr ago', text: 'Finally made one that works. Great tutorial.', likes: 8 },
    ]
  },
]
