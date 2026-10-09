# MJ Veija Turf Passionate Selection

Weekly race-meeting selections for Champ de Mars, Port Louis: three picks per race, the NAP and next best, results and a season record. The site is plain HTML, CSS and JavaScript published with GitHub Pages, with no build step.

## Posting each week

1. Open the site with `#editor` at the end of the address and sign in with your GitHub token (see [Editor token](#editor-token)). Tick **Remember me** on your own phone or computer so you only do this once.
2. Click **New meeting**. It opens on the coming Saturday with eight races and the next day number.
3. Enter up to three picks per race (saddlecloth number and horse name), choose the NAP and next best, then click **Publish meeting**.
4. After racing, click **Edit or add results**, enter each winner's number and publish again. If the winner was one of your picks, its name fills in for you, and the season record updates.
5. Share the card with **Share on WhatsApp**, **Share on Facebook** or **Copy text**.

Each publish is a commit to `data/meetings.json`, and GitHub Pages updates the public site within a minute or two. Unpublished drafts stay on the device you are editing on.

## Editor token

Create a fine-grained personal access token at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access:** Only select repositories, then this repository.
- **Permissions:** Contents, Read and write. Nothing else.
- **Expiration:** your choice. When it expires, sign out on the site and sign in with a new token.

The token is kept in your browser and is only sent to `api.github.com`.

## Files

| Path | Contents |
|---|---|
| `index.html`, `assets/app.css`, `assets/app.js` | The page |
| `assets/config.js` | Site name, and the repository the editor saves to |
| `data/meetings.json` | Every meeting, result and setting. You can also edit it on GitHub. |

A deleted meeting can be recovered from the history of `data/meetings.json`.

## Previewing on your computer

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.
