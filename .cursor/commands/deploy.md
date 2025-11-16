# Deploy

Updated Deployment Process
Build Step: Runs npm run build, which uses Vite (not tsc anymore)
Verification: Checks that:
stashgifs/app/assets/index.js exists (Vite output)
stashgifs/app/assets/feed.css exists (original CSS file, preserved)
Deployment: Copies the entire stashgifs directory to your Stash plugins folder
Important Notes
CSS File: The existing feed.css file in stashgifs/app/assets/ is preserved (Vite config has emptyOutDir: false). The HTML already references it correctly.
React Dependencies: React and ReactDOM are marked as external in Vite config, so they won't be bundled. They'll be loaded from PluginApi.React and PluginApi.ReactDOM at runtime (provided by Stash).
Build Output: Vite outputs to stashgifs/app/assets/index.js (matching what the HTML expects).
To Deploy
Simply run:
.\deploy.ps1
The script will:
Install dependencies if needed
Build with Vite
Verify build output
Copy to your Stash plugins directory

after a successful deploy:

// Cursor Rule: After running a successful deploy, navigate to http://localhost:9999/plugin/stashgifs/assets/app/ in your browser to test all features, read logs, and monitor for errors. Resolve any issues before considering the deployment validated and proceeding.

```sh
git add .
git commit -m "Deploy: successful deployment and validation"
git push
```

*Note: Always run git commands from the project root, not from subdirectories.*
