// Package jssign 提供"在 Go 里跑前端 JS 签名算法"的能力。
//
// 旧项目用 deno_core 跑两份 JS：
//   - 斗鱼：cryptojs.min.js + swf_api/homeH5Enc 下发的混淆脚本（ub98484234）
//   - 抖音：sign.js 的 get_sign()
//
// Wails 版改用纯 Go 的 goja（无 cgo、可交叉编译）。本包只负责"运行时 + 最小
// 浏览器 shim"，具体要跑哪个脚本由调用方决定，因此抖音接入时可以复用。
package jssign

import (
	_ "embed"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// scriptTimeout 防止异常脚本死循环把服务拖死（R-06）。
const scriptTimeout = 3 * time.Second

//go:embed assets/cryptojs.min.js
var cryptoJS []byte

// Runtime 是一个可复用的 goja 运行时。
//
// goja 的 Runtime 不是并发安全的，且脚本执行会往全局对象里塞函数，所以这里用
// 互斥锁串行化。斗鱼签名一次只服务一个房间请求，锁竞争可以忽略。
type Runtime struct {
	mu  sync.Mutex
	vm  *goja.Runtime
	ok  bool // 是否已经注入过 CryptoJS
}

// Compile 把源码编译成可重复执行的 goja 程序。
//
// 编译与执行分开，是为了让"每个房间的混淆脚本"只解析一次就能反复调用。
func Compile(name, src string) (*goja.Program, error) {
	prog, err := goja.Compile(name, src, false)
	if err != nil {
		return nil, fmt.Errorf("jssign: 编译脚本 %s 失败: %w", name, err)
	}
	return prog, nil
}

// New 创建运行时。
func New() *Runtime {
	vm := goja.New()
	// 旧项目在 deno_core 里也做了同样的最小 shim：脚本会探测这些全局变量，
	// 缺失时某些分支会直接抛 ReferenceError。
	_ = vm.Set("window", vm.GlobalObject())
	_ = vm.Set("self", vm.GlobalObject())
	_ = vm.Set("globalThis", vm.GlobalObject())
	_ = vm.Set("console", map[string]any{
		"log":   func(...any) {},
		"warn":  func(...any) {},
		"error": func(...any) {},
		"info":  func(...any) {},
	})
	return &Runtime{vm: vm}
}

// Run 执行一段脚本并返回 JS 结果值的字符串形式。
//
// 执行前会确保 CryptoJS 已注入（斗鱼/抖音的脚本都依赖它，提前注入没有副作用）。
func (r *Runtime) Run(name, src string) (string, error) {
	prog, err := Compile(name, src)
	if err != nil {
		return "", err
	}
	return r.RunProgramIn(prog)
}

// RunProgram 执行已编译的脚本。
func (r *Runtime) RunProgram(prog *goja.Program) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	v, err := r.runGuarded(func() (goja.Value, error) { return r.vm.RunProgram(prog) })
	if err != nil {
		return "", fmt.Errorf("jssign: 执行脚本失败: %w", err)
	}
	return valueString(v)
}

// RunProgramIn 在"已经注入 CryptoJS"的运行时上执行脚本，并返回字符串结果。
//
// 语义等价于旧项目：
//
//	runtime.execute_script(CRYPTO_JS)
//	runtime.execute_script(script)
//	<取返回值>
func (r *Runtime) RunProgramIn(prog *goja.Program) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.ensureCryptoJS(); err != nil {
		return "", err
	}
	v, err := r.runGuarded(func() (goja.Value, error) { return r.vm.RunProgram(prog) })
	if err != nil {
		return "", fmt.Errorf("jssign: 执行脚本失败: %w", err)
	}
	return valueString(v)
}

// Call 在当前全局作用域内执行一条表达式并返回字符串结果。
//
// 用于 "把函数定义跑完后，再带参数调用它" 的两段式场景（斗鱼就是这样）。
// 注意：定义与调用必须在同一次持锁内完成，否则另一个房间的脚本会覆盖掉
// 这里的函数定义 —— 需要两段式时请用 RunProgramInThenCall。
func (r *Runtime) Call(expr string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	v, err := r.runGuarded(func() (goja.Value, error) { return r.vm.RunString(expr) })
	if err != nil {
		return "", fmt.Errorf("jssign: 执行表达式失败: %w", err)
	}
	return valueString(v)
}

// RunProgramInThenCall 是"定义 + 调用"的原子版本。
//
// 斗鱼的签名脚本每次请求都会下发一份新的混淆代码，函数名固定但实现随房间变化，
// 所以必须在同一把锁里完成"跑定义"和"调函数"，否则并发房间会互相污染。
func (r *Runtime) RunProgramInThenCall(prog *goja.Program, expr string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.ensureCryptoJS(); err != nil {
		return "", err
	}
	if _, err := r.runGuarded(func() (goja.Value, error) { return r.vm.RunProgram(prog) }); err != nil {
		return "", fmt.Errorf("jssign: 执行脚本失败: %w", err)
	}
	v, err := r.runGuarded(func() (goja.Value, error) { return r.vm.RunString(expr) })
	if err != nil {
		return "", fmt.Errorf("jssign: 执行表达式失败: %w", err)
	}
	return valueString(v)
}

// runGuarded 在 3 秒超时保护下执行一段 goja 调用。
// 超时后清掉 interrupt 标记，让运行时可以继续服务后续请求。
func (r *Runtime) runGuarded(fn func() (goja.Value, error)) (goja.Value, error) {
	timer := time.AfterFunc(scriptTimeout, func() {
		r.vm.Interrupt("jssign: 脚本执行超时")
	})
	defer timer.Stop()

	v, err := fn()
	if err != nil {
		var interrupted *goja.InterruptedError
		if errors.As(err, &interrupted) {
			r.vm.ClearInterrupt()
			return nil, fmt.Errorf("脚本执行超过 %s", scriptTimeout)
		}
		return nil, err
	}
	return v, nil
}

// ensureCryptoJS 惰性注入 CryptoJS，只做一次。调用方需已持有锁。
func (r *Runtime) ensureCryptoJS() error {
	if r.ok {
		return nil
	}
	if _, err := r.vm.RunScript("cryptojs.min.js", string(cryptoJS)); err != nil {
		return fmt.Errorf("jssign: 注入 CryptoJS 失败: %w", err)
	}
	// 兜底：UMD 在某些宿主里取不到 this，会挂到 exports 上。
	if r.vm.Get("CryptoJS") == nil {
		return fmt.Errorf("jssign: CryptoJS 未挂到全局对象")
	}
	r.ok = true
	return nil
}

func valueString(v goja.Value) (string, error) {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return "", nil
	}
	return v.String(), nil
}

// RunScriptThenCall 编译并执行脚本，然后执行一条表达式，全程持锁。
//
// 这是斗鱼签名的一站式入口：enc 脚本每次请求都变，没必要把 *goja.Program
// 暴露给调用方。
func (r *Runtime) RunScriptThenCall(name, src, expr string) (string, error) {
	prog, err := Compile(name, src)
	if err != nil {
		return "", err
	}
	return r.RunProgramInThenCall(prog, expr)
}

// RunWithCrypto 便捷函数：新建运行时 → 注入 CryptoJS → 执行脚本 → 返回字符串。
func RunWithCrypto(script string) (string, error) {
	r := New()
	prog, err := Compile("script", script)
	if err != nil {
		return "", err
	}
	return r.RunProgramIn(prog)
}
