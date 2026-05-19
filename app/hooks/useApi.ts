import { ApiService } from "@/api/apiService";

const sharedApiService = new ApiService();

export const useApi = () => {
  return sharedApiService;
};
