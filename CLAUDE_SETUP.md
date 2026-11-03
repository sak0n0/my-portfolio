# Claude chat setup

The portfolio chat calls Anthropic from the Node server, so the API key never goes into the browser.

1. Install Node.js 18.18 or newer.
2. Copy `.env.example` to `.env` and put your Anthropic API key after `ANTHROPIC_API_KEY=`.
3. From this folder, run `npm start`.
4. Open `http://localhost:3000` and use the **Ask Claude** button.

For a public deployment, use a Node.js host and set `ANTHROPIC_API_KEY` as a private environment variable in its project settings. The host should run `npm start`. Do not commit `.env` or put the API key in `script.js` or `index.html`.

The model defaults to `claude-sonnet-4-6`. Set `ANTHROPIC_MODEL` on the server to choose another model available to your Anthropic account.
