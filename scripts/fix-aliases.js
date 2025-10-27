// scripts/fix-aliases.js
const fs = require('fs');
const path = require('path');

function replaceAliasesInFile(filePath, isTypeScript = false) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Замена алиасов на относительные пути
  content = content.replace(
    /@react-native-openai-realtime\/([\w\/\-]+)/g,
    (match, modulePath) => {
      const fileDir = path.dirname(filePath);

      // Для TypeScript используем lib/typescript, для JS - lib/module
      const baseDir = isTypeScript
        ? path.join(__dirname, '..', 'lib', 'typescript')
        : path.join(__dirname, '..', 'lib', 'module');

      const targetPath = path.join(baseDir, modulePath);
      let relativePath = path.relative(fileDir, targetPath);

      // Убедимся, что путь начинается с ./
      if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
      }

      // Убираем расширение если оно есть
      relativePath = relativePath.replace(/\.(js|ts)$/, '');

      return relativePath;
    }
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir, isTypeScript = false) {
  if (!fs.existsSync(dir)) {
    console.log(`Directory ${dir} does not exist, skipping...`);
    return;
  }

  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath, isTypeScript);
    } else if (file.endsWith('.js') || file.endsWith('.d.ts')) {
      const isTS = file.endsWith('.d.ts');
      replaceAliasesInFile(filePath, isTS);
    }
  });
}

// Обрабатываем скомпилированные JS файлы
const libModuleDir = path.join(__dirname, '..', 'lib', 'module');
if (fs.existsSync(libModuleDir)) {
  console.log('Fixing aliases in compiled JS files...');
  processDirectory(libModuleDir, false);
  console.log('Done with JS files!');
}

// Обрабатываем TypeScript declaration файлы
const libTypescriptDir = path.join(__dirname, '..', 'lib', 'typescript');
if (fs.existsSync(libTypescriptDir)) {
  console.log('Fixing aliases in TypeScript declaration files...');
  processDirectory(libTypescriptDir, true);
  console.log('Done with .d.ts files!');
}

console.log('All done!');
