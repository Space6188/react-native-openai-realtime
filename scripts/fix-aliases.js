const fs = require('fs');
const path = require('path');

function replaceAliasesInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Замена алиасов на относительные пути
  content = content.replace(
    /@react-native-openai-realtime\/([\w\/\-]+)/g,
    (match, modulePath) => {
      const fileDir = path.dirname(filePath);
      const targetPath = path.join(
        __dirname,
        '..',
        'lib',
        'module',
        modulePath
      );
      let relativePath = path.relative(fileDir, targetPath);

      // Убедимся, что путь начинается с ./
      if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
      }

      // Убираем расширение .js если оно есть в modulePath
      relativePath = relativePath.replace(/\.js$/, '');

      return relativePath;
    }
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (file.endsWith('.js')) {
      replaceAliasesInFile(filePath);
    }
  });
}

// Обрабатываем скомпилированные файлы
const libDir = path.join(__dirname, '..', 'lib', 'module');
if (fs.existsSync(libDir)) {
  console.log('Fixing aliases in compiled files...');
  processDirectory(libDir);
  console.log('Done!');
}
