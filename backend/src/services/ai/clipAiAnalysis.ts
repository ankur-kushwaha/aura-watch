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

export interface ClipAiAnalysis {
  summary: string;
  objectCounts: ClipAiObjectCounts;
  objects: ClipAiDetectedObject[];
}

export function buildVideoAnalysisPrompt(cameraName: string, durationSec?: number): string {
  const durationHint = durationSec && durationSec > 0
    ? `The clip is approximately ${durationSec.toFixed(1)} seconds long.`
    : '';

  return `You are an expert AI video surveillance assistant analyzing a security camera clip from "${cameraName}".
${durationHint}

Respond with ONLY valid JSON (no markdown, no code fences) matching this schema:
{
  "summary": "Narrative of what happens in the clip",
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
  ]
}

Rules:
- First identify every distinct person and vehicle clearly visible in the clip. The "objects" array must include exactly one entry per person and one entry per vehicle — do not merge or skip any.
- type must be "person" or "vehicle" only.
- The "summary" must mention every person and vehicle in "objects". Use distinguishing attributes (clothing, color, vehicle type, movement, location in frame) so each listed object is clearly referenced. If there are 2 people and 3 vehicles, all 5 must appear in the summary.
- Summary and objects must stay consistent: every object in the array appears in the summary, and nothing is mentioned in the summary without a matching objects entry.
- Write 2-4 sentences for simple scenes; use up to 6 sentences when many people or vehicles are present so nothing is left out.
- Omit fields you cannot reasonably infer; use null for unknown scalar fields when the object is present but the attribute is not visible.
- For people: estimate gender and age group (child, teen, adult, elderly) only when visible; list clothing colors/types in clothingColors.
- For vehicles: include color, body style in vehicleType (sedan, SUV, truck, van, motorcycle, bicycle, etc.), and licensePlate only if legible.
- Be objective. Do not invent details not supported by the video.`;
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

  return { summary, objectCounts, objects };
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
