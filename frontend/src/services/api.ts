import axios from 'axios';

const api = axios.create({ baseURL: '', timeout: 30_000 });

api.interceptors.response.use(
  (res) => {
    if (res.data && res.data.success === false) {
      throw new Error(res.data.errorMessage ?? 'Unknown error');
    }
    return res;
  },
  (err) => {
    const msg =
      err.response?.data?.errorMessage ??
      err.response?.data?.message ??
      err.message ??
      'Network error';
    throw new Error(msg);
  },
);

export default api;
