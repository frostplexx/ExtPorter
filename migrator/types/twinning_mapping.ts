export interface TwinningMapping {
  mappings: TwinningReplacement[];
}

export interface TwinningReplacement {
  source: {
    returnType: string;
    formals: TwinningFormal[];
    body: string;
  };
  target: {
    returnType: string;
    formals: TwinningFormal[];
    body: string;
  };
}

export interface TwinningFormal {
  type: string;
  name: string;
}
