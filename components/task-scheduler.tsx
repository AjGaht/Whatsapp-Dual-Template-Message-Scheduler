"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock, Plus, Pause, Play, Trash2, ChevronDown,
  ChevronUp, Clock, Users, CheckCircle, XCircle, AlertCircle,
  Calendar, RefreshCw, X, Wifi, WifiOff, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ScheduledTask, TaskStatus } from "@/lib/scheduler";
import type { Contact } from "@/lib/excel-parser";
import type { Template } from "@/lib/templates";
import type { AccountId, WhatsAppState } from "@/lib/whatsapp";
import { ExcelUploader } from "@/components/excel-uploader";
import { TemplateManager } from "@/components/template-manager";

// ── Common timezones ──────────────────────────────────────────────────────────
const TIMEZONES = [
  "Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Bahrain", "Asia/Qatar",
  "Asia/Muscat", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok",
  "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "UTC",
];

const DELAY_OPTIONS = [
  { label: "Fast (~1s)",   value: 1000 },
  { label: "Normal (~3s)", value: 3000 },
  { label: "Slow (~5s)",   value: 5000 },
  { label: "Safe (~8s)",   value: 8000 },
];

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: "text-primary",          bg: "bg-primary/10 border-primary/20" },
  paused:    { label: "Paused",    color: "text-amber-500",        bg: "bg-amber-500/10 border-amber-500/20" },
  completed: { label: "Completed", color: "text-emerald-500",      bg: "bg-emerald-500/10 border-emerald-500/20" },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", bg: "bg-muted/30 border-border" },
};

// ── Hook: fetch both account statuses ─────────────────────────────────────────
function useAccountStatuses() {
  const [statuses, setStatuses] = useState<Record<AccountId, WhatsAppState>>({
    "account-1": { status: "disconnected", loginMethod: null, qrCode: null, pairingCode: null, phone: null, error: null },
    "account-2": { status: "disconnected", loginMethod: null, qrCode: null, pairingCode: null, phone: null, error: null },
  });

  useEffect(() => {
    const fetch2 = async () => {
      for (const id of ["account-1", "account-2"] as AccountId[]) {
        try {
          const r = await fetch(`/api/whatsapp/${id}/status`);
          const s: WhatsAppState = await r.json();
          setStatuses(prev => ({ ...prev, [id]: s }));
        } catch { /* ignore */ }
      }
    };
    fetch2();
    const t = setInterval(fetch2, 5000);
    return () => clearInterval(t);
  }, []);

  return statuses;
}

// ── Account picker with connection status ────────────────────────────────────
function AccountPicker({ value, onChange }: { value: AccountId; onChange: (a: AccountId) => void }) {
  const statuses = useAccountStatuses();

  return (
    <div className="grid grid-cols-2 gap-2">
      {(["account-1", "account-2"] as AccountId[]).map(a => {
        const s = statuses[a];
        const isConnected = s.status === "connected";
        const isConnecting = ["connecting", "qr_ready", "pairing"].includes(s.status);
        const selected = value === a;

        return (
          <button
            key={a}
            onClick={() => onChange(a)}
            className={`rounded-lg border-2 px-3 py-3 text-xs font-medium transition-all text-left space-y-1.5 ${
              selected
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className={`font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
              {a === "account-1" ? "Account 1" : "Account 2"}
            </div>
            {isConnected ? (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-primary text-[10px]">
                  Connected{s.phone ? ` · +${s.phone}` : ""}
                </span>
              </div>
            ) : isConnecting ? (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-amber-500 text-[10px]">Connecting…</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground text-[10px]">Disconnected</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Create task form ──────────────────────────────────────────────────────────
interface CreateFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function CreateTaskForm({ onCreated, onCancel }: CreateFormProps) {
  const [step, setStep] = useState<"contacts" | "template" | "settings">("contacts");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<AccountId>("account-1");
  const [batchSize, setBatchSize] = useState(20);
  const [sendHour, setSendHour] = useState(9);
  const [sendMinute, setSendMinute] = useState(0);
  const [timezone, setTimezone] = useState("Asia/Dubai");
  const [delayMs, setDelayMs] = useState(3000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const validContacts = contacts.filter(c => c.isValid);
  const totalDays = batchSize > 0 ? Math.ceil(validContacts.length / batchSize) : 0;

  const handleCreate = async () => {
    if (!name.trim()) { setError("Please enter a task name"); return; }
    if (!template)    { setError("Please select a template"); return; }
    if (validContacts.length === 0) { setError("No valid contacts loaded"); return; }

    setSaving(true); setError("");
    try {
      const res = await fetch("/api/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          accountId,
          templateContent: template.content,
          templateName: template.name,
          contacts: validContacts.map(c => c.phone),
          batchSize,
          sendTimeHour: sendHour,
          sendTimeMinute: sendMinute,
          timezone,
          delayMs,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to create task");
      } else {
        onCreated();
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-5 border-primary/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">New Scheduled Task</h3>
        </div>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>

      {/* Step tabs */}
      <div className="flex rounded-lg bg-secondary/50 p-0.5 gap-0.5 mb-4">
        {(["contacts", "template", "settings"] as const).map((s, i) => (
          <button key={s} onClick={() => setStep(s)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
              step === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Step 1: Contacts */}
      {step === "contacts" && (
        <div className="space-y-3">
          <ExcelUploader onContactsLoaded={setContacts} contacts={contacts} />
          {validContacts.length > 0 && (
            <Button className="w-full" size="sm" onClick={() => setStep("template")}>
              Continue with {validContacts.length} contacts →
            </Button>
          )}
        </div>
      )}

      {/* Step 2: Template */}
      {step === "template" && (
        <div className="space-y-3">
          <TemplateManager selectedTemplate={template} onSelectTemplate={setTemplate} />
          {template && (
            <Button className="w-full" size="sm" onClick={() => setStep("settings")}>
              Continue with "{template.name}" →
            </Button>
          )}
        </div>
      )}

      {/* Step 3: Settings */}
      {step === "settings" && (
        <div className="space-y-4">
          {/* Task name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Task name</label>
            <Input placeholder="e.g. Dubai Property Campaign" value={name} onChange={e => setName(e.target.value)} />
          </div>

          {/* Account — with live connection status */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">WhatsApp account</label>
            <AccountPicker value={accountId} onChange={setAccountId} />
          </div>

          {/* Batch size */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Contacts per day</label>
            <Input type="number" min={1} max={validContacts.length} value={batchSize}
              onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))} />
            <p className="text-xs text-muted-foreground">
              {validContacts.length} contacts ÷ {batchSize}/day = <strong>{totalDays} day{totalDays !== 1 ? "s" : ""}</strong>
            </p>
          </div>

          {/* Send time */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Send time each day</label>
            <div className="flex gap-2 items-center">
              <Input type="number" min={0} max={23} value={sendHour}
                onChange={e => setSendHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-20 font-mono" placeholder="HH" />
              <span className="text-muted-foreground font-bold">:</span>
              <Input type="number" min={0} max={59} value={sendMinute}
                onChange={e => setSendMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-20 font-mono" placeholder="MM" />
              <span className="text-xs text-muted-foreground">
                {String(sendHour).padStart(2, "0")}:{String(sendMinute).padStart(2, "0")}
              </span>
            </div>
          </div>

          {/* Timezone */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Timezone</label>
            <select value={timezone} onChange={e => setTimezone(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs">
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          {/* Delay */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Delay between messages</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DELAY_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setDelayMs(o.value)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-mono transition-all text-left ${
                    delayMs === o.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg bg-secondary/50 p-3 text-xs space-y-1 text-muted-foreground">
            <p><strong className="text-foreground">{validContacts.length}</strong> contacts · <strong className="text-foreground">{batchSize}/day</strong> · <strong className="text-foreground">{totalDays} days</strong></p>
            <p>Sends daily at <strong className="text-foreground">{String(sendHour).padStart(2, "0")}:{String(sendMinute).padStart(2, "0")}</strong> ({timezone})</p>
            <p>Template: <strong className="text-foreground">{template?.name}</strong> · Account: <strong className="text-foreground">{accountId === "account-1" ? "Account 1" : "Account 2"}</strong></p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button className="w-full" onClick={handleCreate} disabled={saving}>
            {saving
              ? <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Creating…</>
              : <><CalendarClock className="w-3.5 h-3.5 mr-2" />Create Scheduled Task</>}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, onRefresh }: { task: ScheduledTask; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState(false);
  const statuses = useAccountStatuses();

  const cfg = STATUS_CONFIG[task.status];
  const totalSent = task.contacts.filter(c => c.sentAt).length;
  const totalFailed = task.contacts.filter(c => c.failed).length;
  const totalContacts = task.contacts.length;
  const pct = totalContacts > 0 ? Math.round((totalSent / totalContacts) * 100) : 0;

  const accountStatus = statuses[task.accountId];
  const accountLabel = task.accountId === "account-1" ? "Account 1" : "Account 2";
  const isConnected = accountStatus?.status === "connected";

  const nextRun = task.status === "active"
    ? new Date(task.nextRunAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  const action = async (a: "pause" | "resume" | "cancel") => {
    setActing(true);
    await fetch(`/api/scheduler/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: a }),
    });
    onRefresh();
    setActing(false);
  };

  const handleDelete = async () => {
    await fetch(`/api/scheduler/${task.id}`, { method: "DELETE" });
    onRefresh();
  };

  return (
    <Card className={`p-4 border ${cfg.bg}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{task.name}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.bg} ${cfg.color}`}>
              {cfg.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {/* Account with connection indicator */}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isConnected
                ? <><span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" /><span className="text-primary font-medium">{accountLabel}</span></>
                : <><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 inline-block" /><span>{accountLabel} · disconnected</span></>
              }
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="w-3 h-3" />{task.contacts.length} contacts
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />Day {Math.min(task.currentDay, task.totalDays)}/{task.totalDays}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />{String(task.sendTimeHour).padStart(2, "0")}:{String(task.sendTimeMinute).padStart(2, "0")} {task.timezone}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {task.status === "active" && (
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => action("pause")} disabled={acting}>
              <Pause className="w-3 h-3" />
            </Button>
          )}
          {task.status === "paused" && (
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => action("resume")} disabled={acting}>
              <Play className="w-3 h-3" />
            </Button>
          )}
          {(task.status === "active" || task.status === "paused") && (
            <Button variant="outline" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => action("cancel")} disabled={acting}>
              <X className="w-3 h-3" />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setExpanded(e => !e)}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            <span className="text-primary font-medium">{totalSent}</span> sent ·{" "}
            <span className="text-destructive font-medium">{totalFailed}</span> failed ·{" "}
            {totalContacts - totalSent - totalFailed} pending
          </span>
          <span className="font-mono">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      {/* Status line */}
      {nextRun && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <Clock className="w-3 h-3" /> Next batch: <strong className="text-foreground">{nextRun}</strong> · {task.batchSize} contacts
          {!isConnected && <span className="text-amber-500 ml-1">⚠ Account not connected</span>}
        </p>
      )}
      {task.status === "completed" && (
        <p className="text-xs text-emerald-500 mt-2 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> Completed — all contacts processed
        </p>
      )}
      {task.status === "paused" && (
        <p className="text-xs text-amber-500 mt-2 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> Paused — resume to continue sending
        </p>
      )}

      {/* Expanded: day logs */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Daily log</p>
          {task.dayLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No batches sent yet.</p>
          ) : (
            <div className="space-y-1.5">
              {task.dayLogs.map(log => (
                <div key={log.day} className="flex items-center justify-between rounded-md bg-secondary/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium">Day {log.day}</span>
                    <span className="text-xs text-muted-foreground">{log.date}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-primary flex items-center gap-1"><CheckCircle className="w-3 h-3" />{log.sent}</span>
                    {log.failed > 0 && <span className="text-destructive flex items-center gap-1"><XCircle className="w-3 h-3" />{log.failed}</span>}
                    <span className="text-muted-foreground font-mono">
                      {log.ranAt ? new Date(log.ranAt).toLocaleTimeString(undefined, { timeStyle: "short" }) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Template preview */}
          <div className="rounded-lg bg-[#005c4b] p-3 max-w-sm mt-2">
            <p className="text-[11px] text-white/70 mb-1 uppercase tracking-wider">Template · {task.templateName}</p>
            <p className="text-xs text-white whitespace-pre-wrap leading-relaxed line-clamp-4">{task.templateContent}</p>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;<strong>{task.name}</strong>&quot; and all its progress. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function TaskScheduler() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/scheduler");
      const data = await r.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchTasks();
    intervalRef.current = setInterval(fetchTasks, 15_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchTasks]);

  const activeTasks    = tasks.filter(t => t.status === "active");
  const pausedTasks    = tasks.filter(t => t.status === "paused");
  const completedTasks = tasks.filter(t => t.status === "completed" || t.status === "cancelled");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">Scheduled Tasks</span>
          {activeTasks.length > 0 && (
            <span className="rounded-full bg-primary/15 text-primary text-[10px] font-bold px-2 py-0.5">
              {activeTasks.length} active
            </span>
          )}
        </div>
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Task
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateTaskForm
          onCreated={() => { setShowCreate(false); fetchTasks(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && !showCreate && (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <CalendarClock className="w-10 h-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-sm">No scheduled tasks</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a task to send messages to batches of contacts daily at a set time.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />Create First Task
            </Button>
          </div>
        </Card>
      )}

      {activeTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
          {activeTasks.map(t => <TaskCard key={t.id} task={t} onRefresh={fetchTasks} />)}
        </div>
      )}

      {pausedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Paused</p>
          {pausedTasks.map(t => <TaskCard key={t.id} task={t} onRefresh={fetchTasks} />)}
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed / Cancelled</p>
          {completedTasks.map(t => <TaskCard key={t.id} task={t} onRefresh={fetchTasks} />)}
        </div>
      )}
    </div>
  );
}
