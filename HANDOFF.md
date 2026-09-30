# HANDOFF — Game-Boat 交接文档(给 Codex)

> 交接日期:2026-09-29。前序工作由 ZCode 完成,共 19 个提交(`git log --oneline` 可查)。
> 项目根目录:`/Users/martinwan/codex-project/Game-Boat`

## 项目是什么

Three.js 网页版航母海啸生存模拟器(纯前端,无构建步骤,ES modules + importmap):
337m 福特级航母(程序化建模)、Gerstner 波场(CPU 物理与 GPU 渲染同一份数学)、
逐面元水动力物理、四级海啸(小/中/大/超级巨型 100-150m 水墙)、六种相机
(环绕/跟随/舰桥/甲板/海啸/甲板行走第一人称)、运行时画质调节器。

## 怎么跑

```bash
cd /Users/martinwan/codex-project/Game-Boat
npm run dev          # = python3 tools/serve.py 8765(线程化,勿用 python -m http.server!)
# 打开 http://127.0.0.1:8765
```

调试探针(全部 node 直跑,Chrome 路径已硬编码):
- `tools/boot-check.mjs` — 是否能加载(90s 超时)
- `tools/perf-probe.mjs` — 帧时间/draw call/截图(自动点击进入游戏,带重试)
- `tools/black-hunt.mjs` — 全视角航行逐帧黑屏审计
- `tools/cinema-black.mjs`、`tools/entry-flash.mjs` — 专项黑屏检测
- `tools/physics-test.mjs` — 纯 Node 物理回归(吃水/横摇周期/极速/倾覆,全绿基线:
  吃水≈-0.35m/极速31kn/横摇8.4s/各浪级 0 倾覆)
- `game.advance(seconds)` 可在页面控制台快进模拟(测试海啸弧线神器)

## 必须保持的不变量(改动前先读)

1. **零黑屏**:所有相机遵守"镜头永不下水"(heightAt+余量:orbit+6/chase+12/
   cinema+22 且驻波峰海侧随浪后撤/bridge、deck、walk+1.2);`#underwater` 绿幕
   overlay 是保险层;风暴海面亮度地板(海水体色 mix 雾色 0.16)不能删。
   审计标准:ultra 全程 5 视角循环 131 帧,黑帧=0,水下帧=0。
2. **海面网格中心跟随舰船**(不是相机!)——水线穿模的根因修复,勿改回。
3. **静态几何烘焙**:`ship.js` 的 `bakeStatic()` 按材质合并(~900 draw call→~40)。
   动态物件(旋转雷达 `userData.dynamic`、舰艉旗帜)豁免。
4. **`deckHalfWidth(x, side)`**(ship.js 导出)是甲板轮廓查询函数:水花出生点、
   廊道撑杆、安全网、行走空气墙都依赖它。DECK_OUTLINE 前 15 项是右舷
   (艏→艉),其余是左舷(艉→艏),slice 索引(0,15)/(14) 要一致。
5. **物理**:`physics.js` deck 类面元不参与静水压力(非水密甲板);浮力深度饱和
   38m;水体轨道流速 ±12m/s 饱和;速度/角速度软钳位(60/1.1)。这些是
   "超级巨浪撞穿→弹射→缓沉"弧线的基础,动之前先跑 physics-test。
6. `src/crew.js` 已停用(用户要求移除船员/舰载机,只保留基础设施)。

## ⚠️ 未完成的 bug(本次交接核心)

**现象(用户报告,真机才明显):一按 1/2/3/4 召唤海啸,整个画面瞬间黑一下。**

已查明(证据确凿,勿走弯路):
- 召唤瞬间 `renderer.info.programs` 38→**41**:3 个 `Mesh/MeshStandardMaterial`
  着色器程序**同步编译**。真机上一个重编译卡顿 100-500ms,主线程冻结,
  合成器呈现清空缓冲=整屏黑一瞬(headless SwiftShader 无黑帧是因为它帧率
  ~1fps,采样错过了)。
- 复现/隔离结论(游戏循环内计数,`page.evaluate` + sleep 后读
  `g.renderer.info.programs.length`):
  - 走游戏循环的**合成海啸**(直接 `g.field.spawnTsunami({...})`,绕过
    fireTsunami 的音效/日志)→ **+3 复现**;
  - 仅 `g.storm=0.5`(走循环)→ 不增;仅 `audio.alarm()` → 不增。
- **当前卡点**:boot 预热(main.js `boot()` 里 "Shader-variant warm-up" 块)
  用 `renderer.render()` 直接渲染了海啸/风暴/雨幕状态,但**没有阻止**召唤时
  +3——预热路径与游戏渲染路径(EffectComposer→render target)存在差异。

**建议下一步(按序尝试)**:
1. 把 boot 预热改为走 `this.composer.render()`(游戏真实路径),看召唤是否还 +3;
2. 若仍 +3:给材质命名(`material.name`)后 diff 新程序的
   `programs[i].name` / `vertexShader` 前缀,确定是哪 3 个材质/哪个 cache key
   变化(注意:程序 cache key 含灯光状态、fog、渲染目标色彩空间等);
3. 修复后验证:召唤 1 和 4 各一次,`programs.length` 在召唤前后**不变**,
   再跑一次 black-hunt 确认零黑帧;
4. 别忘了删掉/保留预热代码的取舍:若预热走 composer 后生效,保留并在
   注释里写明为什么必须走 composer。

## 测试环境坑(重要)

- **headless Chrome 残留进程**会抢 CPU 让一切超时:`pkill -f "Google Chrome.*headless"`
  (绝不能 `pkill -f "Google Chrome"`,会杀用户浏览器)。
- SwiftShader 下 shader compile 数秒;探针要等 `#enterBtn.classList.contains('on')`
  (进度条在 runLoading 循环内就显示 100%,`renderer.info.render.frame` 会被
  立方体环境图烘焙污染——都不是可靠就绪信号)。
- puppeteer 点击落在编译长任务里偶发丢失 → "点击+等 UI 状态翻转+重试"
  (参考 tools/perf-probe.mjs 的 clickAndWait)。
- shell 有 http_proxy 时 curl 需 `--noproxy '*'`,puppeteer 需 `--no-proxy-server`。
- waves.js 教训:模块顶层 const 用到 TAU/rand 必须放其声明之后(TDZ)。

## 当前运行状态

dev 服务器可能在跑(端口 8765);交给 Codex 前可 `pkill -f tools/serve.py`
再自行 `npm run dev`。git 工作区干净(WIP 已提交 75695d5)。
