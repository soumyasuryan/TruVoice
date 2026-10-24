export const getApiErrorMessage = (error, fallback = 'Something went wrong.') => {
  const data = error?.response?.data;

  if (!data) {
    return error?.message || fallback;
  }

  if (typeof data.detail === 'string') {
    return data.detail;
  }

  if (Array.isArray(data.detail)) {
    return data.detail.map((item) => item.msg || JSON.stringify(item)).join(', ');
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  return fallback;
};

export default getApiErrorMessage;
