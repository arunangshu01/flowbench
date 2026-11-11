// Pipeline config state as a pure reducer (trivially testable).

export const initialPipeline = {
  dataset_id: "iot-sensors-faulty",
  output_format: "records",
  stages: [
    { kind: "validator", op: "not_null", params: { fields: ["reading_id", "temperature_c"] } },
    { kind: "validator", op: "range", params: { field: "humidity_pct", min: 0, max: 100 } },
    { kind: "validator", op: "unique", params: { fields: ["reading_id"] } },
  ],
};

const MAX_STAGES = 20;

function updateStage(state, index, patch) {
  return { ...state, stages: state.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}

export function pipelineReducer(state, action) {
  switch (action.type) {
    case "set_dataset":
      return { ...state, dataset_id: action.dataset_id };
    case "set_output_format":
      return { ...state, output_format: action.output_format };
    case "add_stage": {
      if (state.stages.length >= MAX_STAGES) return state;
      const stage = { kind: action.kind, op: action.op, params: action.params ?? {} };
      const at = action.index ?? state.stages.length;
      const stages = [...state.stages];
      stages.splice(at, 0, stage);
      return { ...state, stages };
    }
    case "duplicate_stage": {
      if (state.stages.length >= MAX_STAGES) return state;
      const stages = [...state.stages];
      const copy = structuredCloneSafe(stages[action.index]);
      stages.splice(action.index + 1, 0, copy);
      return { ...state, stages };
    }
    case "remove_stage":
      return { ...state, stages: state.stages.filter((_, i) => i !== action.index) };
    case "move_stage": {
      const { index, dir } = action;
      const j = index + dir;
      if (j < 0 || j >= state.stages.length) return state;
      const stages = [...state.stages];
      [stages[index], stages[j]] = [stages[j], stages[index]];
      return { ...state, stages };
    }
    case "set_stage_op":
      return updateStage(state, action.index, { op: action.op, params: action.params ?? {} });
    case "set_param": {
      const params = { ...state.stages[action.index].params };
      if (action.value === undefined) delete params[action.name];
      else params[action.name] = action.value;
      return updateStage(state, action.index, { params });
    }
    case "set_params":
      return updateStage(state, action.index, { params: action.params });
    case "clear_stages":
      return { ...state, stages: [] };
    case "load_config":
      return {
        dataset_id: action.config.dataset_id,
        output_format: action.config.output_format ?? "records",
        stages: (action.config.stages ?? []).map((s) => ({ kind: s.kind, op: s.op, params: { ...(s.params ?? {}) } })),
      };
    default:
      return state;
  }
}

function structuredCloneSafe(v) {
  return JSON.parse(JSON.stringify(v));
}
