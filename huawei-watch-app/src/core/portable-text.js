function isAsciiDigit(code) {
  return code >= 48 && code <= 57;
}

function isAsciiUpper(code) {
  return code >= 65 && code <= 90;
}

function isAsciiLower(code) {
  return code >= 97 && code <= 122;
}

function isAsciiLetterOrDigit(code) {
  return isAsciiDigit(code) || isAsciiUpper(code) || isAsciiLower(code);
}

function isHexCode(code, lowercaseOnly) {
  return (
    isAsciiDigit(code) ||
    (code >= 97 && code <= 102) ||
    (!lowercaseOnly && code >= 65 && code <= 70)
  );
}

export function isUuid(value) {
  if (typeof value !== 'string' || value.length !== 36) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 45) {
        return false;
      }
    } else if (!isHexCode(code, false)) {
      return false;
    }
  }
  return true;
}

export function isLowerHex(value, length) {
  if (typeof value !== 'string' || value.length !== length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!isHexCode(value.charCodeAt(index), true)) {
      return false;
    }
  }
  return true;
}

export function isMachineCode(value, maximumLength = 64) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (!isAsciiDigit(code) && !isAsciiUpper(code) && code !== 95) {
      return false;
    }
  }
  return true;
}

export function sanitizeMachineCode(value, maximumLength = 64) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const upper = value.toUpperCase();
  let result = '';
  let separatorPending = false;
  for (let index = 0; index < upper.length && result.length < maximumLength; index += 1) {
    const code = upper.charCodeAt(index);
    if (isAsciiDigit(code) || isAsciiUpper(code)) {
      if (separatorPending && result.length > 0 && result.length < maximumLength) {
        result += '_';
      }
      if (result.length < maximumLength) {
        result += upper[index];
      }
      separatorPending = false;
    } else if (result.length > 0) {
      separatorPending = true;
    }
  }
  return result || null;
}

export function safeFileToken(value, maximumLength = 48) {
  const source = String(value);
  let result = '';
  for (let index = 0; index < source.length && result.length < maximumLength; index += 1) {
    const code = source.charCodeAt(index);
    result += isAsciiLetterOrDigit(code) || code === 46 || code === 95 || code === 45
      ? source[index]
      : '_';
  }
  return result;
}
