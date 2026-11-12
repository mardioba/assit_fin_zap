import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type Status = {
  whatsappConfigured: boolean;
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  aiProvider: "openai" | "gemini" | "mock";
  queuedOutbox: number;
};

export function WhatsAppPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [phone, setPhone] = useState(user?.whatsappPhone ?? "");
  const [interpretText, setInterpretText] = useState("Gastei 35 reais de combustível.");
  const [interpretResult, setInterpretResult] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Mensagem de teste do painel.");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Status>("/whatsapp/status")
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
    if (user?.whatsappPhone) setPhone(user.whatsappPhone);
  }, [user?.whatsappPhone]);

  async function savePhone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/users/me", { method: "PATCH", body: { whatsappPhone: phone } });
      setMessage("Número vinculado com sucesso. Envie uma mensagem para o bot no WhatsApp!");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar");
    }
  }

  async function runInterpret(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInterpretResult(null);
    try {
      const res = await api<{ interpretation: unknown }>("/whatsapp/test-interpret", {
        method: "POST",
        body: { text: interpretText },
      });
      setInterpretResult(JSON.stringify(res.interpretation, null, 2));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao interpretar");
    }
  }

  async function sendTest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/whatsapp/send", {
        method: "POST",
        body: { phone: testPhone, message: testMessage },
      });
      setMessage("Mensagem enviada (confira o status em /api/whatsapp/status).");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar");
    }
  }

  const PROVIDER_LABEL: Record<string, string> = {
    openai: "OpenAI",
    gemini: "Google Gemini",
    mock: "Local (sem IA externa)",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">WhatsApp</h1>
        <p className="text-sm text-slate-500">
          Integração com a WhatsApp Business Cloud API oficial da Meta
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {message && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Status da integração</h2>
          {!status ? (
            <p className="text-slate-400">Carregando…</p>
          ) : (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span className="text-slate-500">API do WhatsApp</span>
                <span
                  className={status.whatsappConfigured ? "text-emerald-600" : "text-amber-600"}
                >
                  {status.whatsappConfigured ? "Configurada" : "Modo local (sem credenciais)"}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Token de verificação</span>
                <span className={status.verifyTokenSet ? "text-emerald-600" : "text-amber-600"}>
                  {status.verifyTokenSet ? "Definido" : "Ausente"}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Assinatura HMAC (App Secret)</span>
                <span className={status.appSecretSet ? "text-emerald-600" : "text-amber-600"}>
                  {status.appSecretSet ? "Ativa" : "Inativa"}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Interpretador ativo</span>
                <span className="font-medium text-slate-700">
                  {PROVIDER_LABEL[status.aiProvider] ?? status.aiProvider}
                </span>
              </li>
              <li className="flex justify-between">
                <span className="text-slate-500">Mensagens em fila (modo local)</span>
                <span className="font-medium text-slate-700">{status.queuedOutbox}</span>
              </li>
            </ul>
          )}
          <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Configure as variáveis <code>WHATSAPP_*</code> e <code>AI_*</code> no arquivo{" "}
            <code>.env</code> para ativar a API oficial e a IA. Instruções no README
            (seção WhatsApp — Fase 3).
          </p>
        </div>

        <form onSubmit={savePhone} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Vincular meu número</h2>
          <p className="mb-3 text-sm text-slate-500">
            Cadastre o número que usará no WhatsApp (com DDI, ex.: 5511999999999).
            Mensagens de números não vinculados recebem instruções automáticas.
          </p>
          <input
            type="text"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5511999999999"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Vincular número
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form onSubmit={runInterpret} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Testar interpretação da IA</h2>
          <textarea
            value={interpretText}
            onChange={(e) => setInterpretText(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="mt-3 rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Interpretar
          </button>
          {interpretResult && (
            <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
              {interpretResult}
            </pre>
          )}
        </form>

        <form onSubmit={sendTest} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Enviar mensagem de teste</h2>
          <input
            type="text"
            required
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="5511999999999"
            className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Enviar
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <h2 className="mb-2 font-medium text-slate-700">Como configurar a API oficial (Meta)</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Crie um app no Meta Developers com o produto <em>WhatsApp Business</em>.</li>
          <li>Copie o <strong>Phone Number ID</strong> e um <strong>Access Token</strong> de teste/permanente.</li>
          <li>Defina o webhook no Meta: URL <code>https://SEU_DOMINIO/api/whatsapp/webhook</code>,
            token de verificação e <em>App Secret</em> (para assinatura HMAC).</li>
          <li>Preencha <code>WHATSAPP_*</code> no <code>.env</code> e reinicie a API.</li>
          <li>Para a IA: defina <code>OPENAI_API_KEY</code> ou <code>GEMINI_API_KEY</code>
            (sem chaves, o interpretador local pt-BR é usado).</li>
        </ol>
      </div>
    </div>
  );
}
