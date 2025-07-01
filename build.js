import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Read all the component files
const navigation = readFileSync(join('src', 'components', 'navigation.html'), 'utf8');
const heroSection = readFileSync(join('src', 'sections', 'hero.html'), 'utf8');
const aboutSection = readFileSync(join('src', 'sections', 'about.html'), 'utf8');
const resumeSection = readFileSync(join('src', 'sections', 'resume.html'), 'utf8');
const musicSection = readFileSync(join('src', 'sections', 'music.html'), 'utf8');
const booksSection = readFileSync(join('src', 'sections', 'books.html'), 'utf8');

// Read styles
const mainStyles = readFileSync(join('src', 'styles', 'main.css'), 'utf8');
const audioPlayerStyles = readFileSync(join('src', 'styles', 'audio-player.css'), 'utf8');

// Read scripts
const juliaSetScript = readFileSync(join('src', 'scripts', 'julia-set.js'), 'utf8');
const booksScript = readFileSync(join('src', 'scripts', 'books.js'), 'utf8');
const mainScript = readFileSync(join('src', 'scripts', 'main.js'), 'utf8');

// Combine scripts (remove ES6 modules for inline script)
const combinedScript = `
${juliaSetScript.replace(/export\s+/g, '')}
${booksScript.replace(/export\s+/g, '')}
${mainScript.replace(/import\s+{[^}]+}\s+from\s+['"][^'"]+['"];?\s*/g, '')}
`;

// Build the final HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>271</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
${mainStyles}
${audioPlayerStyles}
    </style>
</head>
<body class="bg-white text-gray-900 transition-colors duration-300">
    ${navigation}

    <main class="pl-16 md:pl-16">
        ${heroSection}
        ${aboutSection}
        ${resumeSection}
        ${musicSection}
        ${booksSection}
    </main>

    <script>
${combinedScript}
    </script>
    
    <!-- Add the custom audio player script -->
    <script src="assets/js/audio-player.js"></script>
</body>
</html>
`;

// Write the built file
writeFileSync('index-built.html', html);
console.log('✅ Build complete! Output: index-built.html'); 