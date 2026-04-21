# PDP-11 Assembly Language LSP-Server with DevTools intergration

LSP-сервер (Language Server Protocol) с поддержкой языка **ассемблера PDP-11** в VS Code с интеграцией инструментов разработки.

![Version](https://img.shields.io/badge/version-0.1.4-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)

## Возможности

✨ **Поддержка языка**
- Полная подсветка синтаксиса PDP-11
- Интеллектуальное автодополнение кода
- Сниппеты для удобной разработки
- Навигация по символам и переход к определениям
- Всплывающие подсказки (on hover)

📊 **Диагностика проблем в коде в реальном времени**
- Отображение ошибок и предупреждений
- Интеграция с внешними ассемблерами
- Подсветка в панели проблем
- Настраиваемые таймауты

🔧 **Поддерживает ассемблеры**
- **pdpy11** – ассемблер PDP-11 на Python - [ссылка на проект](https://github.com/pdpy11/pdpy11)
- **BKTurbo8** – Кросс Ассемблер БК Турбо8 для компьютеров серии БК - [ссылка на проект](https://gid.pdp-11.ru/bkturbo8_doc.html)
- **MACRO11** – Portable DEC MACRO11 assembler - [ссылка на проект](https://github.com/j-hoppe/MACRO11)

🎯 **Возможности для разработки**
- Выбор целевого аппаратного профиля (БК-0010, БК-0011, УКНЦ)
- Поддержка форматов (.s, .asm, .mac)
- Запуск сборки из редактора
- Настройка аргументов сборки
- Автозапуск в эмуляторе - после успешной сборки

## Установка

### Через VS Code Marketplace
1. Откройте VS Code Extensions (`Ctrl+Shift+X`)
2. Найдите **"PDP-11 Assembler LSP server and Tools"**
3. Нажмите **Install**

### Через ручную установку в VS Code 
1. Скачайте расширение в виде файла .vsix в разделе release
2. Откройте VS Code Extensions (`Ctrl+Shift+X`)
2. Нажмите "..." и запустите **Install from VSIX**

### Ручная установка
```bash
git clone https://github.com/kalininskiy/pdp11-asm-lsp-server.git
cd pdp11-asm-lsp-server
npm install
npm run compile
# Package as VSIX:
npm install -g @vscode/vsce
vsce package
```

## Быстрый старт

### 1. Создайте ассемблерный файл (PDP-11, здесь: пример для БК-0010)
с расширением `.asm`, `.s`, или `.mac`:
```asm
        MOV     #HELLO,R1           ; Адрес начала текста
        CLR     R2                  ; Конец текста - нулевой байт
        EMT     20                  ; Вывод текста
STOP:   HALT                        ; Останов
HELLO:  .ASCIZ "Hello World!"
        .END
```

### 2. Настройте выбранный ассемблер
Нажмите `Ctrl+Shift+P` найдите запускаемые файлы для правильной настройки:
- **PDP-11: Select pdpy11 Executable**
- **PDP-11: Select BKTurbo8 Executable**
- **PDP-11: Select MACRO11 Executable**

### 3. Запустите
Нажмите `Ctrl+Shift+P` и запустите:
- **PDP-11: Assemble with pdpy11**
- **PDP-11: Assemble with BKTurbo8**
- **PDP-11: Assemble with MACRO11**

## Настройки

### Основные настройки

Нажмите CTRL + , и вбейте в поисковую строку "pdp11"

## Установка ассемблеров

### pdpy11

**Установка:**
```bash
pip install pdpy11
# или
brew install pdpy11  # macOS
```

**Исходники:** https://github.com/pdpy11/pdpy11

**Быстрый старт:**
```bash
pdpy11 --implicit-bin program.mac
```

---

### BKTurbo8

Идет в составе эмулятора - https://gid.pdp-11.ru/

**Документация:** https://gid.pdp-11.ru/bkturbo8_doc.html

**Быстрый старт:**
```bash
BKTurbo8_x64.exe CO program.asm
```

---

### MACRO11
Portable DEC MACRO11 assembler - https://github.com/j-hoppe/MACRO11

---

## Команды плагина

Все команды доступные по запуску (`Ctrl+Shift+P`):

### настройка путей к запускаемым файлам ассемблеров
- **PDP-11: Select pdpy11 Executable** – Set pdpy11 binary location
- **PDP-11: Select BKTurbo8 Executable** – Set BKTurbo8 binary location
- **PDP-11: Select MACRO11 Executable** – Set MACRO11 binary location

### Запуск ассемблеров
- **PDP-11: Assemble with pdpy11** – Compile active file with pdpy11
- **PDP-11: Assemble with BKTurbo8** – Compile active file with BKTurbo8
- **PDP-11: Assemble with MACRO11** – Compile active file with MACRO11

## Разработка проекта

### Структура проекта
```
pdp11-asm-lsp-server/
├── client/                      # VS Code extension client
│   ├── src/extension.ts         # Main extension entry
│   ├── package.json
│   └── tsconfig.json
├── server/                      # Language server backend
│   ├── src/
│   │   ├── server.ts            # LSP server implementation
│   │   ├── analyzer.ts          # Code analysis
│   │   ├── parser.ts            # PDP-11 parser
│   │   ├── tokenizer.ts         # Lexical analysis
│   │   ├── toolchain.ts         # Assembler integration
│   │   ├── instructions.ts      # PDP-11 instruction set
│   │   └── types.ts             # TypeScript types
│   ├── package.json
│   └── tsconfig.json
├── syntaxes/pdp11-asm.tmLanguage.json  # Syntax highlighting
├── snippets/pdp11.json          # Code snippets
├── language-configuration.json   # Language config
└── .vscode/
    ├── launch.json              # Debug configuration
    └── tasks.json               # Build tasks
```

### Сборка и отладка проекта

**Prerequisites:**
- Node.js 18+ and npm
- TypeScript 5.6+
- Git

**Шаги для сборки:**
```bash
# Clone repository
git clone https://github.com/kalininskiy/pdp11-asm-lsp-server.git
cd pdp11-asm-lsp-server

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (development)
npm run watch

# Lint code
npm run lint
```

### Запуск в режиме отладки

1. Откройте проект в VS Code
2. Нажмите `F5` для запуска Debug Extension
3. Откроется новое окно VS Code с загруженным расширением
4. Откройте или создайте файл с раширением `.asm` для тестирования

### Сборка релиза

```bash
# Установите vsce (VS Code Extension CLI)
npm install -g @vscode/vsce

# Соберите Package в виде .vsix
vsce package
```

## Контрибьюторы

Исправления и любое участие в проекте приветствуется!

Простые шаги чтобы начать участие в проекте:

1. Сделайте форк репозитория
2. Создайте feature branch (`git checkout -b feature/amazing-feature`)
3. Сделайте Commit изменений (`git commit -m 'Add amazing feature'`)
4. Сделайте Push изменений в feature branch (`git push origin feature/amazing-feature`)
5. Откройте Pull Request в проект

## Лицензия

MIT License – see LICENSE file for details

## Поддержка и ссылки

- **Issues:** [GitHub Issues](https://github.com/kalininskiy/pdp11-asm-lsp-server/issues)
- **pdpy11 Docs:** https://github.com/pdpy11/pdpy11
- **BKTurbo8 Docs:** https://gid.pdp-11.ru/bkturbo8_doc.html
- **PDP-11 Reference:** https://en.wikipedia.org/wiki/PDP-11

---

## 📞 Контакты

(с) 2026 by Ivan "VDM" Kalininskiy
- Telegram: [@VanDamM](https://t.me/VanDamM)
- GitHub: [kalininskiy](https://github.com/kalininskiy)
