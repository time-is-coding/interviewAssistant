import { useEffect, useState } from 'react';

import { ApiError, api } from '../api/client.ts';
import type { LlmConfigInput, ProviderPreset, TestResult } from '../api/types.ts';
import {
  Card,
  Field,
  Notice,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from '../components/Ui.tsx';

export default function Settings() {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.getLlmSettings();
        setPresets(data.presets);
        setPresetId(data.config.presetId);
        setBaseUrl(data.config.baseUrl);
        setModel(data.config.model);
        setApiKeyMasked(data.config.apiKeyMasked);
        setHasApiKey(data.config.hasApiKey);
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activePreset = presets.find((p) => p.id === presetId);

  function handlePresetChange(nextId: string) {
    setPresetId(nextId);
    setTestResult(null);
    setAvailableModels([]);

    const preset = presets.find((p) => p.id === nextId);
    // 「自定义」不清空用户已填的内容，其余预设回填默认地址与模型
    if (preset && preset.id !== 'custom') {
      setBaseUrl(preset.baseUrl);
      setModel(preset.defaultModel);
    }
  }

  /** 组装请求体：Key 未被改动时省略，表示沿用后端已保存的 Key。 */
  function buildInput(): LlmConfigInput {
    const input: LlmConfigInput = { presetId, baseUrl, model };
    if (apiKeyDirty) input.apiKey = apiKeyInput;
    return input;
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setSavedNotice(null);
    try {
      const result = await api.testLlm(buildInput());
      setTestResult(result);
      if (result.ok && result.models) setAvailableModels(result.models);
    } catch (err) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof ApiError ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSavedNotice(null);
    try {
      const { config } = await api.saveLlmSettings(buildInput());
      setApiKeyMasked(config.apiKeyMasked);
      setHasApiKey(config.hasApiKey);
      setApiKeyInput('');
      setApiKeyDirty(false);
      setSavedNotice('配置已保存');
    } catch (err) {
      setSavedNotice(err instanceof ApiError ? `保存失败：${err.message}` : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (loadError) return <Notice kind="error">{loadError}</Notice>;

  return (
    <>
      <PageHeader
        title="模型设置"
        description="面试官与评分都由大模型驱动。本地模型和云端 API 走同一套协议，换一个预设即可。"
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="接入配置">
          <div className="grid gap-4">
            <Field label="供应商预设" hint={activePreset?.note}>
              <select
                className={inputClass}
                value={presetId}
                onChange={(e) => handlePresetChange(e.target.value)}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.requiresKey ? '（需要 API Key）' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Base URL" hint="OpenAI 兼容接口地址，通常以 /v1 结尾">
              <input
                className={inputClass}
                value={baseUrl}
                placeholder="http://localhost:11434/v1"
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setTestResult(null);
                }}
              />
            </Field>

            <Field
              label="模型名"
              hint={
                availableModels.length > 0
                  ? `已拉取到 ${availableModels.length} 个可用模型，可从列表选择`
                  : '测试连接成功后会自动拉取可用模型列表'
              }
            >
              <input
                className={inputClass}
                value={model}
                list="available-models"
                placeholder="qwen2.5:7b"
                onChange={(e) => {
                  setModel(e.target.value);
                  setTestResult(null);
                }}
              />
              <datalist id="available-models">
                {availableModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>

            <Field
              label="API Key"
              hint={
                hasApiKey
                  ? `已保存：${apiKeyMasked}。留空表示沿用已保存的 Key。`
                  : '本地模型通常不需要填。填写后仅保存在本机数据库，不会下发给浏览器。'
              }
            >
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  value={apiKeyInput}
                  placeholder={hasApiKey ? '（留空则沿用已保存的 Key）' : 'sk-...'}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setApiKeyDirty(true);
                    setTestResult(null);
                  }}
                />
                {hasApiKey && (
                  <button
                    type="button"
                    className={`${buttonSecondary} shrink-0`}
                    onClick={() => {
                      setApiKeyInput('');
                      setApiKeyDirty(true);
                    }}
                  >
                    清除
                  </button>
                )}
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button className={buttonPrimary} onClick={handleTest} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button className={buttonSecondary} onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存配置'}
              </button>
              {savedNotice && <span className="text-xs text-emerald-400">{savedNotice}</span>}
            </div>
          </div>
        </Card>

        <div className="grid content-start gap-5">
          <Card title="连接状态">
            {!testResult && <p className="text-sm text-slate-500">尚未测试。</p>}

            {testResult?.ok && (
              <div className="grid gap-3">
                <Notice kind="success">
                  连接正常，耗时 {testResult.latencyMs} ms
                </Notice>
                {testResult.models && (
                  <div>
                    <p className="mb-2 text-xs text-slate-500">
                      可用模型（{testResult.models.length}）
                    </p>
                    <ul className="max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs">
                      {testResult.models.map((m) => (
                        <li key={m}>
                          <button
                            type="button"
                            className="w-full rounded px-2 py-1 text-left font-mono text-slate-300 hover:bg-slate-800"
                            onClick={() => {
                              setModel(m);
                              setTestResult(null);
                            }}
                          >
                            {m}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!testResult.models && (
                  <p className="text-xs text-slate-500">
                    该服务未提供模型列表接口，已通过一次最小请求确认可用。
                  </p>
                )}
              </div>
            )}

            {testResult && !testResult.ok && (
              <Notice kind="error">{testResult.error ?? '连接失败'}</Notice>
            )}
          </Card>

          <Card title="本地模型">
            <p className="text-xs leading-relaxed text-slate-400">
              用本地 Ollama 时，先确认已启动服务并拉取模型：
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              <code>{'ollama serve\nollama pull qwen2.5:7b'}</code>
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              本地模型不产生费用，但追问深度受模型能力限制。对面试官的回答质量有要求时，云端模型通常更稳。
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
