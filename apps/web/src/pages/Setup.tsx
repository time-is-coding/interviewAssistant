import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client.ts';
import type { DifficultyLevel, Persona, Resume } from '../api/types.ts';
import {
  Card,
  Field,
  Notice,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from '../components/Ui.tsx';

export default function Setup() {
  const { resumeId = '' } = useParams();
  const navigate = useNavigate();

  const [resume, setResume] = useState<Resume | null>(null);
  const [levels, setLevels] = useState<DifficultyLevel[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [level, setLevel] = useState(3);
  const [personaId, setPersonaId] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const loadPersonas = useCallback(async (keepSelection?: string) => {
    const { personas: list } = await api.listPersonas();
    setPersonas(list);
    if (keepSelection && list.some((p) => p.id === keepSelection)) setPersonaId(keepSelection);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [resumeData, levelData, personaData] = await Promise.all([
          api.getResume(resumeId),
          api.listDifficultyLevels(),
          api.listPersonas(),
        ]);
        setResume(resumeData.resume);
        setLevels(levelData.levels);
        setPersonas(personaData.personas);

        const first = personaData.personas[0];
        if (first) {
          setPersonaId(first.id);
          setPromptDraft(first.prompt);
        }
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [resumeId]);

  const selected = personas.find((p) => p.id === personaId);
  const activeLevel = levels.find((l) => l.level === level);

  function selectPersona(p: Persona) {
    setPersonaId(p.id);
    setPromptDraft(p.prompt);
    setCustomMode(false);
    setSaveNotice(null);
  }

  async function handleSaveAsMine() {
    const name = window.prompt('给这位面试官起个名字', selected ? `${selected.name}·改` : '我的面试官');
    if (!name?.trim()) return;
    try {
      const { persona } = await api.createPersona({
        name: name.trim(),
        description: selected ? `基于「${selected.name}」修改` : '自定义面试官',
        prompt: promptDraft,
      });
      await loadPersonas(persona.id);
      setPromptDraft(persona.prompt);
      setCustomMode(false);
      setSaveNotice(`已保存为「${persona.name}」，可在面试官列表中选用`);
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const { session } = await api.createSession({
        resumeId,
        difficulty: level,
        ...(customMode
          ? {
              personaPrompt: promptDraft,
              personaName: selected ? `${selected.name}（本次调整）` : '自定义面试官',
            }
          : { personaId }),
      });
      navigate(`/interview/${session.id}`);
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : String(err));
      setStarting(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (loadError) return <Notice kind="error">{loadError}</Notice>;

  return (
    <>
      <PageHeader
        title="面试配置"
        description={
          resume?.profile?.targetRole
            ? `候选人：${resume.profile.targetRole}${resume.profile.yearsOfExperience ? ` · ${resume.profile.yearsOfExperience}` : ''}`
            : '选择难度与面试官，然后开始面试'
        }
      />

      <div className="grid gap-5">
        {/* 难度 */}
        <Card
          title="面试难度"
          description={activeLevel ? `上限 ${activeLevel.maxRounds} 轮，达到后自动进入评分` : undefined}
        >
          <div className="grid gap-2 sm:grid-cols-5">
            {levels.map((l) => (
              <button
                key={l.level}
                onClick={() => setLevel(l.level)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  level === l.level
                    ? 'border-emerald-600 bg-emerald-950/40'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <span
                  className={`block text-xs ${level === l.level ? 'text-emerald-400' : 'text-slate-500'}`}
                >
                  L{l.level}
                </span>
                <span className="mt-0.5 block text-sm text-slate-200">{l.label}</span>
              </button>
            ))}
          </div>
          {activeLevel && (
            <p className="mt-3 text-xs leading-relaxed text-slate-400">{activeLevel.positioning}</p>
          )}
        </Card>

        {/* 面试官 */}
        <Card
          title="面试官"
          description="内置面试官按公开面经整理的风格设定，选中后可在下方调整提示词"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPersona(p)}
                className={`rounded-lg border px-3.5 py-3 text-left transition-colors ${
                  personaId === p.id && !customMode
                    ? 'border-emerald-600 bg-emerald-950/40'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm text-slate-200">{p.name}</span>
                  {p.builtin && (
                    <span className="rounded border border-slate-700 px-1.5 py-px text-[10px] text-slate-500">
                      内置
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* 提示词 */}
        <Card
          title="面试官提示词"
          description="决定面试官问什么、怎么问。改动只影响本次面试，需要复用请另存。"
        >
          <Field label="提示词内容">
            <textarea
              className={`${inputClass} h-72 resize-y font-mono text-xs leading-relaxed`}
              value={promptDraft}
              readOnly={!customMode}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setCustomMode(true);
              }}
              onFocus={() => setCustomMode(true)}
            />
          </Field>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!customMode ? (
              <button className={buttonSecondary} onClick={() => setCustomMode(true)}>
                修改提示词
              </button>
            ) : (
              <>
                <span className="text-xs text-amber-400">已修改，本次面试将使用下方内容</span>
                <button className={buttonSecondary} onClick={handleSaveAsMine}>
                  另存为我的面试官
                </button>
                <button
                  className={buttonSecondary}
                  onClick={() => {
                    if (selected) setPromptDraft(selected.prompt);
                    setCustomMode(false);
                  }}
                >
                  还原
                </button>
              </>
            )}
            {saveNotice && <span className="text-xs text-emerald-400">{saveNotice}</span>}
          </div>
        </Card>

        {startError && <Notice kind="error">{startError}</Notice>}

        <div className="flex flex-wrap items-center gap-3">
          <button className={buttonPrimary} onClick={handleStart} disabled={starting}>
            {starting ? '正在生成开场提问…' : '开始面试'}
          </button>
          <button className={buttonSecondary} onClick={() => navigate('/')}>
            返回
          </button>
          {starting && (
            <span className="text-xs text-slate-500">
              需要调用一次大模型生成开场问题，本地模型可能稍慢
            </span>
          )}
        </div>
      </div>
    </>
  );
}
