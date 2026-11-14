import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function toE164(country: CountryCode, input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

// A fixed list; India first.
const COUNTRY_NAMES: Array<[CountryCode, string]> = [
  ["IN", "India"],
  ["NP", "Nepal"],
  ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"],
  ["AE", "United Arab Emirates"],
];

export const COUNTRY_OPTIONS = COUNTRY_NAMES.map(([code, name]) => ({
  code,
  label: `${name} (+${getCountryCallingCode(code)})`,
}));
