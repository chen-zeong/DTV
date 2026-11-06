// Package services 是 Go 业务逻辑与前端之间的 IPC 边界。
package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DataTransferFile 是原生文件对话框的返回结果。
//
// Content 只在导入时有值；Path / Name 在导入和导出时都会返回。
type DataTransferFile struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

// DataTransferService 提供 JSON 配置文件的导入 / 导出能力。
//
// 只负责系统文件对话框和磁盘读写，配置内容的序列化与合并逻辑都在前端
// （frontend/src/lib/configTransfer.ts），这样可以和局域网同步共用一套
// 增量合并规则。
type DataTransferService struct{}

// NewDataTransferService 创建配置文件传输服务。
func NewDataTransferService() *DataTransferService {
	return &DataTransferService{}
}

// PickImportJSONFile 打开系统文件选择框并读取选中的 JSON 文件。
//
// 用户取消时返回 (nil, nil)，前端据此静默忽略。
func (s *DataTransferService) PickImportJSONFile() (*DataTransferFile, error) {
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return nil, fmt.Errorf("当前环境不支持系统文件对话框")
	}

	path, err := app.Dialog.OpenFile().
		SetTitle("导入 DTV 配置").
		SetMessage("选择由 DTV 导出的 JSON 配置文件").
		AddFilter("DTV 配置", "*.json").
		CanCreateDirectories(false).
		PromptForSingleSelection()
	if err != nil {
		return nil, fmt.Errorf("打开文件对话框失败：%w", err)
	}
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败：%w", err)
	}

	return &DataTransferFile{
		Name:    filepath.Base(path),
		Path:    path,
		Content: string(data),
	}, nil
}

// SaveExportJSONFile 打开系统保存框并写入配置文本。
//
// suggestedName 为空时使用 dtv-config.json；用户取消时返回 (nil, nil)。
func (s *DataTransferService) SaveExportJSONFile(content string, suggestedName string) (*DataTransferFile, error) {
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return nil, fmt.Errorf("当前环境不支持系统文件对话框")
	}

	name := strings.TrimSpace(suggestedName)
	if name == "" {
		name = "dtv-config.json"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".json") {
		name += ".json"
	}

	path, err := func() (string, error) {
		dialog := app.Dialog.SaveFile()
		dialog.SetOptions(&application.SaveFileDialogOptions{Title: "导出 DTV 配置"})
		return dialog.
			SetMessage("选择配置文件的保存位置").
			AddFilter("DTV 配置", "*.json").
			SetFilename(name).
			CanCreateDirectories(true).
			AllowsOtherFileTypes(true).
			PromptForSingleSelection()
	}()
	if err != nil {
		return nil, fmt.Errorf("打开保存对话框失败：%w", err)
	}
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	if filepath.Ext(path) == "" {
		path += ".json"
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return nil, fmt.Errorf("写入配置文件失败：%w", err)
	}

	return &DataTransferFile{
		Name: filepath.Base(path),
		Path: path,
	}, nil
}
