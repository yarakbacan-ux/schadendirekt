export type DvsaDefect = {
  dangerous?: boolean | null;
  text?: string | null;
  type?: string | null;
};

export type DvsaMotTest = {
  completedDate?: string | null;
  motTestNumber?: string | number | null;
  dataSource?: string | null;
  expiryDate?: string | null;
  regMarkTimeOfTest?: string | null;
  registrationAtTimeOfTest?: string | null;
  testResult?: string | null;
  odometerValue?: string | number | null;
  odometerUnit?: string | null;
  odometerResultType?: string | null;
  defects?: DvsaDefect[] | null;
};

export type DvsaVehicle = {
  registration?: string | null;
  vin?: string | null;
  firstUsedDate?: string | null;
  registrationDate?: string | null;
  manufactureDate?: string | null;
  primaryColour?: string | null;
  secondaryColour?: string | null;
  engineSize?: string | number | null;
  model?: string | null;
  make?: string | null;
  fuelType?: string | null;
  lastMotTestDate?: string | null;
  dataSource?: string | null;
  last_update_date?: string | null;
  lastUpdateDate?: string | null;
  lastUpdateTimestamp?: string | null;
  modification?: 'CREATED' | 'UPDATED' | 'DELETED' | string | null;
  last_modification?: 'CREATED' | 'UPDATED' | 'DELETED' | string | null;
  motTests?: DvsaMotTest[] | null;
};

export type DvsaBulkFile = {
  filename: string;
  downloadUrl: string;
  fileSize: number;
  fileCreatedOn: string;
};

export type DvsaBulkDownloadResponse = {
  bulk?: DvsaBulkFile[];
  delta?: DvsaBulkFile[];
};

export type DvsaErrorBody = {
  errorCode?: string;
  code?: string;
  errorMessage?: string;
  message?: string;
};
