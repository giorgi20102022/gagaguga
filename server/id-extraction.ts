export type N8nIdResult = {
  // n8n output may use either `firstName`/`lastName` or `name`/`surname`.
  firstName?: string;
  lastName?: string;
  name?: string;
  surname?: string;
  personalId?: string;
  birthDate?: string;
  gender?: string;
  expiryDate?: string;
};

export type ExtractedIdData = {
  firstName?: string;
  lastName?: string;
  idNumber?: string;
};

export function mapN8nResultToIdData(result: N8nIdResult): ExtractedIdData {
  return {
    firstName: result.firstName ?? result.name,
    lastName: result.lastName ?? result.surname,
    idNumber: result.personalId,
  };
}

export function stripDataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf("base64,");
  if (idx === -1) return dataUrl.trim();
  return dataUrl.slice(idx + "base64,".length).trim();
}
