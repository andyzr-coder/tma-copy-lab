# TMA Copy Lab

一个公开、无需登录的中文交互教学网站，用小矩阵解释 **concat、slice、im2col 如何拆成基础 copy 搬运**。

在线访问：**https://andyzr-coder.github.io/tma-copy-lab/**

这个仓库独立于 ADA300 硬件项目。仓库中只有网站、教学地址模型和测试，不包含原始 RTL、Word 规格、凭据或实际设备数据。

## 怎么学

1. 从 concat 开始，播放 A、B 分别写入输出的过程。
2. 切换 slice，改变起点、区域大小和正步长，观察源地址与目的地址的关系。
3. 切换 im2col，先按窗口理解展开，再按核位置成批搬运。
4. 选择“对齐后，4 条 copy”，对照当前描述符和固定版本 RTL 的几何限制。

支持播放 / 暂停、前后单步、进度拖动、点击格子追溯来源、点击指令跳转、输出矩阵分页、通道切换、参数链接分享，以及描述符 JSON 下载。

## 模型和拆分

- `concat`：两输入沿一个轴拼接，未拼接轴相等；每个输入一个矩形 copy。
- `slice`：连续矩形使用一个 copy；正的取行步长通过源行距表达；隔列取样按输出列段拆分。
- `im2col`：采用 NHWC 输入与 `[N×P×Q][R×S×C]` 输出，一个窗口占一行；包括两个可对比的拆分顺序。
- 核位置策略：stride 为 1 时，每个 batch、核位置的有效输出区域是矩形，使用三维 copy；padding 先由外部清零，再仅搬有效区域。其他 stride 使用每个 `n,p,r,s` 一条二维 copy，沿有效 q 范围搬运。
- 窗口策略：按窗口、核行搬连续段，横向 dilation 大于 1 时进一步拆开。
- 每个可视格表示一段连续元素，通道控件只改变显示哪一个元素；实际模型搬运整段。
- 普通 copy 不产生 padding 的零。清零作为外部前置步骤，不混入 copy 指令计数和有效搬运量。

## 参考与边界

固定参考版本：`64cda54608278fc973be7132cc7f338b699adaeb`。

本网页实现独立的精确地址教学模型，以及普通 linear→linear CP 的部分静态检查：基地址 128B 对齐、行距 256B 对齐、dim0 坐标 128B 对齐、CONV/MATMUL 宽度取整、取整后 box 的几何边界。导出示例统一使用 CONV 模式，字段为 CP 风格描述符，base 为相应缓冲区内的字节偏移。

**动画正确和检查通过，都不代表已经通过 RTL 仿真或可以直接下发设备。** 真正执行仍需有效物理地址、分配边界、通道字段转换和系统验证。LD/ST 与 CP 不使用完全相同的描述符。batch 由外层循环推进，不假设原生四维 walker。

不模拟卷积乘加、burst 时序、总线反压、bank conflict、性能、折叠布局、transpose、gather/scatter、SWA、4bit 打包、量化零点、负步长 slice 或重叠源目的缓冲区。

参数为教学而限幅：输入空间尺寸 2–7，核尺寸 / stride / dilation 1–3，padding 0–2，batch 1–2，每格元素数最多 128；支持 8/16/32bit 元素。网页不上传用户输入，资源不依赖第三方 CDN。

## 本地运行

无构建步骤，使用任意静态 HTTP 服务，例如：

```sh
python -m http.server 8766
```

打开 `http://localhost:8766`。ES modules 需要通过 HTTP 打开，建议不要直接双击 HTML。

## 验证

```sh
node --test tests/engine.test.mjs
```

测试使用独立的输出映射，对照每一条描述符的地址遍历，覆盖不同元素宽度、向量长度、slice 步长，以及 240 组卷积参数下的两种 im2col 策略；另外检查空输出、全 padding、对齐取整和越界情况。

浏览器检查需要本机可用的 Playwright 和 Chromium：

```sh
node tests/browser.cjs
```

可以通过 `TEST_URL` 更换站点地址、`BROWSER_EXECUTABLE` 指定浏览器。浏览器检查覆盖实际播放和暂停、参数修改、指令跳转、通道选择、JSON 下载、URL 参数恢复，以及 1440 / 390 / 320px 布局。QA 结果仅生成在被忽略的 `.qa/` 目录。

## 部署

GitHub Pages 从 `codex/copy-lab` 分支的仓库根目录发布。修改网站后运行相应测试，再提交并推送到该分支。仓库根目录的 `.nojekyll` 保持资源按静态文件发布。
