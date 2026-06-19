export interface ClipAiPersonObject {
  type: 'person';
  age?: string | null;
  gender?: string | null;
  clothingColors?: string[];
}

export interface ClipAiVehicleObject {
  type: 'vehicle';
  color?: string | null;
  vehicleType?: string | null;
  licensePlate?: string | null;
}

export type ClipAiDetectedObject = ClipAiPersonObject | ClipAiVehicleObject;

export interface ClipAiObjectCounts {
  person: number;
  vehicle: number;
}

export interface ClipAiAlert {
  triggeredInstruction: string | null;
  alertTitle: string;
  alertBody: string;
  riskLevel: 'medium' | 'high';
}

export interface ClipAiAnalysis {
  summary: string;
  objectCounts: ClipAiObjectCounts;
  objects: ClipAiDetectedObject[];
  riskLevel?: 'low' | 'medium' | 'high' | null;
  alerts?: ClipAiAlert[];
}

export function buildVideoAnalysisPrompt(cameraName: string, durationSec?: number, alertInstructions?: string[]): string {
  const durationHint = durationSec && durationSec > 0
    ? `The clip is approximately ${durationSec.toFixed(1)} seconds long.`
    : '';

  const customRulesList = alertInstructions && alertInstructions.length > 0
    ? alertInstructions.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : 'None';

  return `You are an expert AI video surveillance assistant analyzing a security camera clip from "${cameraName}".
${durationHint}

Evaluate the video content and respond with ONLY valid JSON (no markdown, no code fences) matching this schema:
{
  "summary": "Detailed narrative of what happens in the clip",
  "objects": [
    {
      "type": "person",
      "age": "adult",
      "gender": "male",
      "clothingColors": ["red jacket", "blue jeans"]
    },
    {
      "type": "vehicle",
      "color": "white",
      "vehicleType": "SUV",
      "licensePlate": "ABC1234"
    }
  ],
  "riskLevel": "low" | "medium" | "high",
  "alerts": [
    {
      "triggeredInstruction": "exact text of the matched custom rule, or null if triggered by general security risk",
      "alertTitle": "Short alert title (max 60 chars)",
      "alertBody": "One sentence explaining why it triggered",
      "riskLevel": "medium" | "high"
    }
  ]
}

Rules for evaluation:
1. First identify every distinct person and vehicle clearly visible in the clip. The "objects" array must include exactly one entry per person and one entry per vehicle — do not merge or skip any.
2. type must be "person" or "vehicle" only.
3. The "summary" must mention every person and vehicle in "objects". Use distinguishing attributes (clothing, color, vehicle type, movement, location in frame).
4. Omit fields you cannot reasonably infer; use null for unknown fields.
5. Assess the threat/risk level of the clip:
   - "high": weapon visible, person running urgently, forced entry, large crowd (5+ people), vehicle loitering, abandoned object, nighttime intrusion.
   - "medium": unknown person lingering, vehicle in restricted area.
   - "low": normal pedestrian traffic, single person walking through, known staff.
6. Custom Alert Rules to check:
${customRulesList}

7. Alerts list generation:
   - For EACH custom rule listed above that is triggered by the clip activity, append an entry to the "alerts" array with "triggeredInstruction" matching the rule text, the appropriate "riskLevel" (medium or high), and custom title/body.
   - If NO custom rules are triggered, but the general security risk level is "medium" or "high", include a single entry in "alerts" with "triggeredInstruction": null, and general title/body.
   - If the overall clip is low risk and no custom rules trigger, "alerts" must be an empty array [].
8. Set the top-level "riskLevel" to the highest risk level among all triggered alerts, or "low" if no alerts triggered.`;
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function asOptionalString(value: unknown): string | null | undefined {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeObject(raw: Record<string, unknown>): ClipAiDetectedObject | null {
  const type = String(raw.type || '').toLowerCase();
  if (type === 'person') {
    return {
      type: 'person',
      age: asOptionalString(raw.age ?? raw.ageGroup),
      gender: asOptionalString(raw.gender),
      clothingColors: asStringArray(raw.clothingColors ?? raw.clothesColor ?? raw.clothesColors),
    };
  }
  if (type === 'vehicle' || type === 'car') {
    return {
      type: 'vehicle',
      color: asOptionalString(raw.color),
      vehicleType: asOptionalString(raw.vehicleType ?? (type === 'car' ? 'car' : raw.bodyStyle)),
      licensePlate: asOptionalString(raw.licensePlate ?? raw.numberPlate),
    };
  }
  return null;
}

function countObjects(objects: ClipAiDetectedObject[]): ClipAiObjectCounts {
  return {
    person: objects.filter((obj) => obj.type === 'person').length,
    vehicle: objects.filter((obj) => obj.type === 'vehicle').length,
  };
}

export function parseClipAiAnalysis(raw: string): ClipAiAnalysis {
  const parsed = JSON.parse(stripJsonFences(raw)) as Record<string, unknown>;
  const summary = String(parsed.summary || '').trim();
  if (!summary) {
    throw new Error('AI summary JSON is missing a non-empty "summary" field');
  }

  const objects = Array.isArray(parsed.objects)
    ? parsed.objects
        .map((item) => (item && typeof item === 'object' ? normalizeObject(item as Record<string, unknown>) : null))
        .filter((item): item is ClipAiDetectedObject => item != null)
    : [];

  const objectCounts = parsed.objectCounts && typeof parsed.objectCounts === 'object'
    ? {
        person: Number((parsed.objectCounts as Record<string, unknown>).person) || 0,
        vehicle: Number((parsed.objectCounts as Record<string, unknown>).vehicle) || 0,
      }
    : countObjects(objects);

  const riskLevel = parsed.riskLevel
    ? (String(parsed.riskLevel).toLowerCase() as 'low' | 'medium' | 'high')
    : null;
  // Read old fields from parsed json for backward compatibility fallback
  const oldTriggered = parsed.triggeredByInstruction ? String(parsed.triggeredByInstruction) : null;
  const oldTitle = parsed.alertTitle ? String(parsed.alertTitle) : null;
  const oldBody = parsed.alertBody ? String(parsed.alertBody) : null;

  // Parse alerts array
  const alerts: ClipAiAlert[] = [];
  if (Array.isArray(parsed.alerts)) {
    for (const item of parsed.alerts) {
      if (item && typeof item === 'object') {
        const title = String(item.alertTitle || item.title || '').trim();
        const body = String(item.alertBody || item.body || '').trim();
        const level = String(item.riskLevel || 'medium').toLowerCase() as 'medium' | 'high';
        const rule = item.triggeredInstruction !== undefined
          ? (item.triggeredInstruction ? String(item.triggeredInstruction).trim() : null)
          : (item.triggeredByInstruction ? String(item.triggeredByInstruction).trim() : null);

        if (title && body) {
          alerts.push({
            triggeredInstruction: rule,
            alertTitle: title,
            alertBody: body,
            riskLevel: level === 'high' ? 'high' : 'medium',
          });
        }
      }
    }
  }

  // Backward compatibility fallback:
  if (alerts.length === 0 && (riskLevel === 'medium' || riskLevel === 'high') && (oldTitle || oldBody)) {
    alerts.push({
      triggeredInstruction: oldTriggered,
      alertTitle: oldTitle || 'Security Event',
      alertBody: oldBody || summary || 'An event of interest was detected.',
      riskLevel: riskLevel,
    });
  }

  return {
    summary,
    objectCounts,
    objects,
    riskLevel,
    alerts,
  };
}

/** Parse model output and return canonical JSON string for storage. */
export function normalizeAiSummaryJson(raw: string): string {
  return JSON.stringify(parseClipAiAnalysis(raw));
}

export function tryParseClipAiAnalysis(raw?: string | null): ClipAiAnalysis | null {
  if (!raw?.trim()) return null;
  try {
    return parseClipAiAnalysis(raw);
  } catch {
    return null;
  }
}

export function getAiSummaryNarrative(raw?: string | null): string {
  const parsed = tryParseClipAiAnalysis(raw);
  if (parsed) return parsed.summary;
  return raw?.trim() || '';
}

export function formatAiObjectForSearch(obj: ClipAiDetectedObject): string {
  if (obj.type === 'person') {
    return [
      'person',
      obj.gender,
      obj.age ? `age ${obj.age}` : null,
      obj.clothingColors?.length ? `wearing ${obj.clothingColors.join(', ')}` : null,
    ].filter(Boolean).join(', ');
  }

  return [
    'vehicle',
    obj.color ? `${obj.color} color` : null,
    obj.vehicleType,
    obj.licensePlate ? `plate ${obj.licensePlate}` : null,
  ].filter(Boolean).join(', ');
}

export function formatAiAnalysisForSearch(raw?: string | null): string {
  const parsed = tryParseClipAiAnalysis(raw);
  if (!parsed) return raw?.trim() || '';
  const objectText = parsed.objects.map(formatAiObjectForSearch).join('\n');
  return objectText ? `${parsed.summary}\n${objectText}` : parsed.summary;
}

export function formatAiAnalysisForContext(raw?: string | null): string {
  const parsed = tryParseClipAiAnalysis(raw);
  if (!parsed) return raw?.trim() || '';
  if (parsed.objects.length === 0) return parsed.summary;

  const objectLines = parsed.objects.map((obj, index) => {
    const label = `Object ${index + 1}`;
    if (obj.type === 'person') {
      return [
        `${label} (person)`,
        obj.gender ? `gender: ${obj.gender}` : null,
        obj.age ? `age: ${obj.age}` : null,
        obj.clothingColors?.length ? `clothing: ${obj.clothingColors.join(', ')}` : null,
      ].filter(Boolean).join('; ');
    }
    return [
      `${label} (vehicle)`,
      obj.color ? `color: ${obj.color}` : null,
      obj.vehicleType ? `type: ${obj.vehicleType}` : null,
      obj.licensePlate ? `license plate: ${obj.licensePlate}` : null,
    ].filter(Boolean).join('; ');
  });

  const counts = `${parsed.objectCounts.person} person(s), ${parsed.objectCounts.vehicle} vehicle(s)`;
  return `${parsed.summary}\nDetected: ${counts}\n${objectLines.join('\n')}`;
}
