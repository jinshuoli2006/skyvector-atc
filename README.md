# SkyVector ATC · 空中交通管制雷达模拟器

一个全新实现的浏览器版 ATC 小游戏。前端是纯静态 HTML/CSS/JavaScript Canvas，可直接部署到 GitHub Pages；Python 只用于离线生成 `data/scenarios.json`，不需要后端服务。

## 设计目标

- 不迁移任何现有项目代码，只复刻核心玩法灵感：拖拽指挥、进近落地、离场放行、安全间隔、地面等待。
- 修复常见误判：**起飞后的离场飞机经指定交接门飞出管制区时判定为成功移交，而不是失败**。
- 进近飞机获“准许落地”后进入自动进近/自动落地：系统会规划截获点、截获五边、自动调航向、速度和高度，避免玩家频繁遭遇“进近不稳定”。
- UI 使用深色玻璃拟态雷达、响应式布局、通信记录、航班详情和地面队列。
- GitHub Pages 友好：仓库根目录下有 `index.html`，无需构建步骤。

## 本地运行

因为浏览器对 `file://` 下的 `fetch()` 有限制，建议用一个静态服务器打开：

```bash
cd skyvector-atc
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

## 调控难度

游戏里有两个最直接的难度入口：

- `场景`：Level 越高，进近和离场数量越多，天气也更复杂。
- `流量`：不改 JSON 的情况下临时缩放本局班次。新手建议选 `训练 40%` 或 `轻松 60%`。

流量档位不仅减少飞机数量，也会拉大进入/排队时间，并适当放宽地面等待限制。

## 重新生成场景

默认生成器已经调成训练友好流量：Level 1 为 3 架进近 + 2 架离场。

```bash
python tools/generate_scenarios.py --count 5 --seed 20260521 --output data/scenarios.json
```

你可以通过这些参数进一步调低或调高班次：

```bash
python tools/generate_scenarios.py \
  --count 5 \
  --base-arrivals 1 \
  --base-departures 1 \
  --arrival-step 1 \
  --departure-step 0 \
  --spacing-multiplier 1.5 \
  --output data/scenarios.json
```

含义：

- `--base-arrivals`：每个场景的基础进近数量。
- `--base-departures`：每个场景的基础离场数量。
- `--arrival-step`：每升一级增加多少架进近。
- `--departure-step`：每升一级增加多少架离场。
- `--spacing-multiplier`：放大进场/排队间隔；数值越大越轻松。

你也可以直接编辑 `data/scenarios.json`。

## GitHub Pages 部署

### 方式 A：直接从分支发布

1. 把本项目文件提交到你的 GitHub 仓库。
2. 进入仓库 `Settings` → `Pages`。
3. `Build and deployment` 选择 `Deploy from a branch`。
4. Branch 选择 `main`，目录选择 `/root`。
5. 保存后等待 Pages 完成发布。

### 方式 B：使用 GitHub Actions

本项目包含 `.github/workflows/pages.yml`。在 `Settings` → `Pages` 中把 Source 改为 `GitHub Actions`，之后 push 到 `main` 会自动发布。

## 玩法

- 点击飞机查看呼号、机型、高度、速度和目标。
- 在雷达上拖拽飞机，松开后下达新航向。
- 对进近飞机点击“准许落地 / 自动进近”后，飞机会自动飞向对应跑道的五边截获点，随后自动对准跑道、减速、下降并落地。玩家只需要在许可前保证它大致还在管制区内、没有明显冲突。
- 自动进近接通后，雷达上会显示绿色虚线航迹和 `AUTO FINAL` 标记；航班标签会显示 `AUTO`。
- 对离场队列点击“放行起飞”，然后引导到目标交接门。
- 离场飞机在目标交接门附近、达到移交高度后飞出边界，会自动成功移交。
- 间隔不足、进近飞机飞出管制区、离场偏离交接门或地面等待超时会导致失败。

## 文件结构

```text
skyvector-atc/
├── index.html
├── assets/styles.css
├── js/game.js
├── data/scenarios.json
├── tools/generate_scenarios.py
├── .github/workflows/pages.yml
├── .nojekyll
└── README.md
```

## 可继续扩展

- 增加复飞按钮，让自动进近不满足间隔时可以取消落地并重新排序。
- 加入语音指令解析，例如 `CPA812 heading 180 descend 3000`。
- 把天气单元做成真实绕飞约束。
- 增加 SID/STAR 航线、跑道占用、复飞和滑行逻辑。
- 增加 replay 导出，便于复盘冲突。
