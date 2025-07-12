# MDgent Config Tab Test Plan

## Test Steps

1. **Launch the app**
   - Run `npm run dev`
   - App should start successfully

2. **Navigate to Config tab**
   - Click on the "Config" button in the tab bar (next to Files and Debug)
   - Config view should be displayed

3. **Test loading default prompt**
   - The default prompt should be displayed in the text area
   - The prompt should contain placeholders like `{relativePath}` and `{content}`

4. **Test editing prompt**
   - Edit the prompt text
   - Add custom instructions or modify existing ones

5. **Test saving prompt**
   - Click "Save Changes" button
   - Should see "Prompt saved successfully!" message
   - The custom prompt will be saved to `~/.mdgent/prompt-config.json`

6. **Test reset functionality**
   - After making changes, click "Reset to Default"
   - The prompt should revert to the default template

7. **Test persistence**
   - Save a custom prompt
   - Restart the app
   - Navigate back to Config tab
   - The custom prompt should be loaded

8. **Test usage**
   - With a custom prompt saved, analyze a file in a repository
   - The generated documentation should use the custom prompt template

## Implementation Summary

The Config tab allows users to:
- View and edit the prompt template used for documentation generation
- Save custom prompts that persist across app sessions
- Reset to the default prompt
- Use variables `{relativePath}` and `{content}` in their custom prompts

The configuration is stored in `~/.mdgent/prompt-config.json` and is loaded by the daemon on startup.