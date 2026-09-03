/* 意图文本归一 —— **全仓唯一一份**(05d 立)

   为什么单开这么小一个文件:它被 39 处用着,而 05d 搬模块时出了这么一档子事 ——
   `isGreetingOnly` / `hasServiceStartIntent` 从 `local-server.mjs` 搬进 `ai-gate.mjs` 后,
   它们调的 `compactIntentText` 在新文件里是 `createAiGate` 的**注入参数**(闭包里),
   而搬过去的函数在**模块顶层**,拿不到 —— 接口当场 500 `compactIntentText is not defined`。

   顺带暴露了自由标识符扫描器的边界:它是**文件级**的,不做作用域分析,
   名字只要在文件里被绑定过就算数,**绑在别人的闭包里也算**。所以那一版扫描是绿的。
   (登记在《判据缺陷 J 族》J-08。)

   根治不是「在新文件里再抄一份」——那是《一件事两处真相》的又一例,
   而是把它提成公共件,谁要谁 import。 */
export function compactIntentText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}
