# Push

Before pushing your changes to git, always execute the following steps from the root of the project directory:

1. Check the status of your repository:
    ```sh
    git status
    ```
    Review the output to verify which files will be pushed.

2. (Optional but recommended) Fetch and review the latest changes on the remote to avoid conflicts:
    ```sh
    git fetch
    git status
    ```
    Ensure your local branch is up to date with the remote.

3. Add and commit your changes:
    ```sh
    git add .
    git commit -m "your commit message"
    ```

4. Push your changes to the remote repository:
    ```sh
    git push
    ```

*Note: Never run git commands from a subdirectory. Always ensure you are at the project root before pushing. Always check status before pushing to avoid mistakes with unintended files or missed updates from the remote.*

