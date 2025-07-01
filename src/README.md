# Personal Site - Modular Structure

## Directory Structure

```
src/
├── components/      # Reusable components (navigation, etc.)
├── sections/        # Page sections (hero, about, resume, etc.)
├── styles/          # CSS files
│   ├── main.css     # Main styles
│   └── audio-player.css  # Audio player specific styles
└── scripts/         # JavaScript modules
    ├── julia-set.js # Julia set animation
    ├── books.js     # Books data and rendering
    └── main.js      # Main application logic
```

## Development Workflow

### 1. Edit modular files
Make changes to any file in the `src/` directory:
- To edit a section: `src/sections/[section-name].html`
- To edit styles: `src/styles/main.css` or `src/styles/audio-player.css`
- To edit scripts: `src/scripts/[script-name].js`

### 2. Build the site
```bash
npm run build
```
This combines all modular files into `index-built.html`

### 3. Watch mode (auto-rebuild)
```bash
npm run watch
```
This will automatically rebuild when any source file changes.

### 4. Deploy
After building, rename `index-built.html` to `index.html` and deploy.

## Adding New Sections

1. Create a new HTML file in `src/sections/`
2. Add the section to `build.js`:
   ```javascript
   const newSection = readFileSync(join('src', 'sections', 'new-section.html'), 'utf8');
   ```
3. Include it in the HTML template in `build.js`
4. Add navigation links in `src/components/navigation.html`

## Benefits of This Structure

- **Maintainability**: Each section is in its own file
- **Reusability**: Components can be shared
- **Organization**: Clear separation of concerns
- **Version Control**: Easier to track changes to specific sections
- **Collaboration**: Multiple people can work on different sections

## Production Build

For production, you might want to:
1. Minify the CSS and JavaScript
2. Optimize images
3. Add cache busting
4. Use a proper bundler like Vite or Webpack for more advanced features 