import axios from 'axios';

const { apiHost = '' } = window.fillnodeConfig || {};
const wootAPI = axios.create({ baseURL: `${apiHost}/` });

export default wootAPI;
