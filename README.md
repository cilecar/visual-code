# Nodus

Десктопное приложение для визуального программирования блоками-нодами в духе Unreal Blueprints,
Node-RED и Blender Geometry Nodes. Программа собирается на бесконечном холсте из блоков, которые
соединяются проводами, затем компилируется в читаемый Python 3 и запускается. Во время выполнения
видно, какой блок и какая строка сгенерированного кода исполняются прямо сейчас.

Стек: **Tauri 2** (Rust) · **Svelte 5** + TypeScript + Vite · **@xyflow/svelte** (Svelte Flow) ·
**CodeMirror 6** · Python 3 + `sys.settrace`. Работает на Fedora под Wayland и X11.

## Возможности

- Два вида связей: **exec** (белые треугольные порты, задают порядок) и **data** (цветные круглые
  порты: number голубой, string розовый, bool красный, list жёлтый, any серый).
  Несовместимые порты при перетаскивании провода тускнеют, совместимые подсвечиваются.
- Если отпустить провод в пустоте, откроется поиск блоков, отфильтрованный по типу порта. Новый блок
  создаётся уже подключённым.
- Блоки: события (`Start`, `On Timer`), поток (`If`, `While`, `For Range`, `For Each`, `Sequence`,
  `Break`), переменные, математика и логика, строки, списки, ввод/вывод, функции и `Python Code`.
- Режимы запуска Run, Slow (задержка на шаг 0–2 с), Step, Continue и Stop. Breakpoints ставятся
  на блоке или в гаттере редактора кода.
- Во время выполнения активный блок пульсирует неоновым свечением, а пройденные блоки оставляют
  затухающий след. По exec-проводу бежит частица, на data-проводах всплывают значения, в коде
  подсвечивается текущая строка. При ошибке блок краснеет и трясётся, а рядом появляется тултип.
- В редакторе есть выделение рамкой, копирование и вставка (в том числе между файлами), `Ctrl+D`,
  undo/redo, привязка к сетке, выравнивание и распределение. Двойной клик по проводу добавляет
  reroute-точку. Ещё есть комментарии-фреймы, валидация в реальном времени, автосохранение
  с восстановлением после краха, недавние файлы и командная палитра `Ctrl+K`.

## Сборка на Fedora

### 1. Зависимости

```sh
sudo dnf install -y nodejs npm rust cargo python3 \
  webkit2gtk4.1-devel gtk3-devel libsoup3-devel javascriptcoregtk4.1-devel \
  openssl-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel \
  curl wget file rpm-build @development-tools
```

Нужны Node.js 20.19+ (или 22.12+) и Rust 1.80+. Если версия Rust из `dnf` устарела, поставьте
свежую через rustup: `curl https://sh.rustup.rs -sSf | sh`.

### 2. Разработка

```sh
npm install
npm run tauri dev
```

`npm run dev` открывает только фронтенд в браузере на http://localhost:1420. Даже без Tauri в этом
режиме программы можно запускать: dev-сервер Vite (`dev-runner.ts`) играет роль Rust-раннера.

### 3. Тесты

```sh
npm test             # Vitest: кодогенерация, граф, сериализация, пользовательские блоки
npm run test:py      # pytest: трассировщик runner/trace.py (нужен python3-pytest)
npm run check        # svelte-check / TypeScript
```

### 4. Пакеты .rpm и AppImage

```sh
npm run tauri build
```

Результат появится в `src-tauri/target/release/bundle/`:

- `rpm/Nodus-0.1.0-1.x86_64.rpm` ставится командой `sudo dnf install ./Nodus-*.rpm`
- `appimage/Nodus_0.1.0_amd64.AppImage` запускается после `chmod +x` (для AppImage нужен `fuse-libs`)
- `deb/` собирается заодно, чтобы получить из него Flatpak по рецепту Flathub

Только нужные форматы: `npm run tauri build -- --bundles rpm,appimage`.

### 5. Flatpak

Локальная сборка из готового бинарника:

```sh
sudo dnf install -y flatpak-builder
flatpak install -y flathub org.gnome.Platform//49 org.gnome.Sdk//49
npm run tauri build -- --no-bundle
flatpak-builder --user --install --force-clean flatpak/build-dir flatpak/io.github.nodus.Nodus.yml
flatpak run io.github.nodus.Nodus
```

Для Flathub нужна сборка из исходников без сети. Сгенерируйте `cargo-sources.json` и
`node-sources.json` с помощью [flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools)
(`flatpak-cargo-generator.py src-tauri/Cargo.lock` и `flatpak-node-generator npm package-lock.json`),
затем добавьте их в `sources` и замените `build-commands` на `npm ci --offline && npm run tauri build`.
Это описано в [руководстве Tauri](https://v2.tauri.app/distribute/flatpak/).

### Wayland и NVIDIA

Если на проприетарном драйвере NVIDIA окно получается пустым или мерцает, запускайте с
`WEBKIT_DISABLE_DMABUF_RENDERER=1 nodus`.

## Горячие клавиши

| Клавиша | Действие |
| --- | --- |
| `Space` / ПКМ по холсту | поиск блока под курсором |
| `Del` / `Backspace` | удалить выделенное |
| `F5` / `Shift+F5` | Run / Stop |
| `F10` / `F8` | Step / Continue |
| `F9`, `Alt`+клик | точка останова на блоке |
| `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O` / `Ctrl+N` | сохранить / сохранить как / открыть / новый |
| `Ctrl+Z` / `Ctrl+Shift+Z` | отменить / повторить |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | копировать / вырезать / вставить / дублировать |
| `Ctrl+A` | выделить всё |
| `Ctrl+G` | свернуть выделение в функцию |
| `C` | комментарий-фрейм вокруг выделения |
| `G` | привязка к сетке |
| `F` | показать всё (fit view) |
| `Ctrl+J` | показать или скрыть нижнюю панель |
| `Ctrl+K` | командная палитра |

## Архитектура

```
src-tauri/            Rust: файлы, автосохранение, пользовательские блоки, раннер
  src/runner.rs       запуск python3 trace.py в отдельной группе процессов, стрим событий
                      пачками (≤ 60 Гц) через Tauri event `runner-events`, kill группы при Stop
runner/trace.py       трассировщик на sys.settrace: JSON-события в stdout, команды в stdin
runner/tests/         pytest
src/lib/types.ts      модель: блоки, порты, граф, документ
src/lib/blocks/       реестр и разрешение портов
  defs/*.json         декларативные описания блоков (один файл на блок)
src/lib/graph/        индекс графа, топосорт, валидация, undo-стек, .blk, буфер обмена,
                      выравнивание, сворачивание в функцию
src/lib/codegen/      компилятор граф → Python + source map (+ Vitest)
src/lib/runtime/      связь с бэкендом и состояние выполнения
src/lib/stores/       состояние редактора и UI
src/lib/ui/           компоненты: BlockNode, Port, WireEdge, Canvas, Sidebar, Inspector, Dock…
examples/             Hello World, FizzBuzz, «Угадай число»
```

### Кодогенерация

Каждое событие (`Start`, `On Timer`, вход функции) становится Python-функцией. Её тело получается
обходом exec-связей в глубину. Exec-циклы обнаруживаются топологической сортировкой (Kahn) и
выдаются как ошибка: для повторов есть `While` и `For`. Pure-блоки (математика, сравнения, `Get Var`)
не порождают своих строк, их выражения подставляются по месту использования, а скобки ставятся
только там, где они нужны. Выходы exec-блоков (`Input.text`, `For.index`) становятся локальными
переменными с читаемыми именами (`answer`, `i`, `item`), цепочки `If → If` сворачиваются в `elif`.

Source map хранит соответствия «строка → id блока» и «id блока → строки». Ещё в нём есть *watches*:
выражения data-проводов без побочных эффектов, которые отладчик вычисляет, когда блок начинает
выполняться. Из них получаются всплывающие значения на проводах. `Random` никогда не
перевычисляется.

### Протокол трассировщика

События (stdout, по одному JSON на строку):
`start`, `line {line,node_id}`, `vars {globals,locals}`, `values {node_id,values}`, `stdout {text}`,
`paused {line,node_id,reason}`, `resumed`, `input_request {prompt}`, `error {line,node_id,msg,traceback}`,
`done {status}`.

Команды (stdin): `step`, `continue`, `pause`, `mode {mode,delay_ms}`, `breakpoints {nodes}`, `input {text}`.

В режиме Run события `line` прореживаются до 30 Гц, `vars` до 5 Гц. Защита:
`RLIMIT_CPU` (по умолчанию 30 с процессорного времени, пауза не считается), `RLIMIT_AS` 2 ГБ,
лимит вывода 2 МБ, при Stop процесс убивается вместе со всей группой (`killpg`).
Лимиты меняются в `localStorage`: `nodus.cpuLimit`, `nodus.outputLimit`, `nodus.python`.

## Пользовательские блоки

Положите JSON-файл в `~/.local/share/nodus/blocks/` и выполните команду
«Перезагрузить пользовательские блоки» (`Ctrl+K`) или нажмите ⟳ в палитре. Пример лежит
в [`docs/user-block-example.json`](docs/user-block-example.json):

```json
{
  "id": "user.clamp", "title": "Clamp", "category": "math", "icon": "arrow-down-up", "kind": "pure",
  "inputs": [{ "id": "x", "type": "number", "default": 0 }, { "id": "lo", "type": "number", "default": 0 },
             { "id": "hi", "type": "number", "default": 10 }],
  "outputs": [{ "id": "result", "type": "number" }],
  "expr": { "result": "max({raw.lo}, min({raw.hi}, {raw.x}))" }
}
```

- `kind` принимает значения `pure` (выражение без exec-портов, поле `expr`), `exec` (инструкции,
  поле `code`) или `event`.
- Exec-порты задаются как `{ "id": "exec", "type": "exec" }` на входе и `{ "id": "then", "type": "exec" }` на выходе.
- `icon` — имя иконки [Lucide](https://lucide.dev/icons) в kebab-case.
- Токены шаблона:
  - `{in.x}` — выражение входа, в скобках при необходимости
  - `{raw.x}` — то же без скобок
  - `{int.x}` — целое значение
  - `{out.x}` — переменная выхода exec-блока
  - `{exec.x}` — тело exec-ветки (на отдельной строке, с отступом)
  - `{param.x}` — литерал параметра
  - `{text.x}` — текст параметра
  - `{name.var}` — имя переменной

## Формат .blk

JSON со `schemaVersion`. В нём хранятся `variables`, `functions` (у каждой функции свой граф),
`main.nodes` (блоки, reroute-точки и комментарии-фреймы с позициями, параметрами, inline-значениями,
breakpoints и заметками), `main.edges` (`sourceHandle`/`targetHandle` в виде `out:<порт>` и
`in:<порт>`) и `viewport`. Файлы старых схем мигрируются при открытии.
