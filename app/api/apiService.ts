import { getApiDomain } from "@/utils/domain";
import { ApplicationError } from "@/types/error";

export class ApiService {
  private baseURL: string;
  private defaultHeaders: HeadersInit;

  constructor() {
    this.baseURL = getApiDomain(); // Klasse die backend URL holt, damit Frontend weiss wohin es die Requests schicken soll
    this.defaultHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };
  }

  /**
   * Helper function to check the response, parse JSON,
   * and throw an error if the response is not OK.
   *
   * @param res - The response from fetch.
   * @param errorMessage - A descriptive error message for this call.
   * @returns Parsed JSON data.
   * @throws ApplicationError if res.ok is false.
   */

  // Helpermethode die nach jedem Requst schuat ob Antwort gut war, wenn nicht wirft sie Fehler auf
  private async processResponse<T>(
    res: Response,
    errorMessage: string,
  ): Promise<T> {
    if (res.ok && (res.status === 204 || res.status === 205)) {
      return undefined as T;
    }
    if (!res.ok) {
      let errorDetail = res.statusText;
      try {
        const errorInfo = await res.json();
        if (errorInfo?.message) {
          errorDetail = errorInfo.message;
        } else {
          errorDetail = JSON.stringify(errorInfo);
        }
      } catch {
        // If parsing fails, keep using res.statusText
      }
      const detailedMessage = `${errorMessage} (${res.status}: ${errorDetail})`;
      const error: ApplicationError = new Error(
        detailedMessage,
      ) as ApplicationError;
      error.info = JSON.stringify(
        { status: res.status, statusText: res.statusText },
        null,
        2,
      );
      error.status = res.status;
      throw error;
    }
    return res.headers.get("Content-Type")?.includes("application/json")
      ? (res.json() as Promise<T>)
      : Promise.resolve(res as T);
  }

  /**
   * GET request.
   * @param endpoint - The API endpoint (e.g. "/users").
   * @returns JSON data of type T.
   */

  // schickt GET Request ans backend um verschiedene User Profile zu holen. Cache disabled to make redirect no break in case of outdated token etc.
  public async get<T>(endpoint: string): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: this.defaultHeaders,
    });
    return this.processResponse<T>(
      res,
      "An error occurred while fetching the data.\n",
    );
  }

  /**
   * POST request.
   * @param endpoint - The API endpoint (e.g. "/users").
   * @param data - The payload to post.
   * @returns JSON data of type T.
   */

  // Schickt POST Request mit den Daten ans backend und kann so zb einen neuen User regisstrieren
  public async post<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.defaultHeaders,
      body: JSON.stringify(data),
    });
    return this.processResponse<T>(
      res,
      "An error occurred while posting the data.\n",
    );
  }

  /**
   * PUT request.
   * @param endpoint - The API endpoint (e.g. "/users/123").
   * @param data - The payload to update.
   * @returns JSON data of type T.
   */

  // Schickt PUT Request um z.b das Passwort zu ändern
  public async put<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.defaultHeaders,
      body: JSON.stringify(data),
    });
    return this.processResponse<T>(
      res,
      "An error occurred while updating the data.\n",
    );
  }

  /**
   * DELETE request.
   * @param endpoint - The API endpoint (e.g. "/users/123").
   * @returns JSON data of type T.
   */
  public async delete<T>(endpoint: string): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.defaultHeaders,
    });
    return this.processResponse<T>(
      res,
      "An error occurred while deleting the data.\n",
    );
  }

  private authHeaders(token: string): HeadersInit {
    return {
      ...this.defaultHeaders,
      Authorization: token,
    };
  }

  private handleUnauthorized(status?: number): void {
    if (status !== 401 || typeof window === "undefined") {
      return;
    }

    try {
      globalThis.localStorage.removeItem("token");
      globalThis.localStorage.removeItem("userId");
      globalThis.localStorage.removeItem("activeSessionId");
      globalThis.localStorage.removeItem("activeLobbySessionId");
      globalThis.localStorage.removeItem("pendingInitialPeekGameId");
    } catch {
      // best-effort cleanup only
    }

    const pathname = globalThis.location?.pathname ?? "";
    const isAuthRoute = pathname === "/" || pathname === "/login" || pathname === "/register";
    if (!isAuthRoute) {
      globalThis.location.assign("/login");
    }
  }

  public async getWithAuth<T>(endpoint: string, token: string): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store", // Cache disabled to make redirect no break in case of outdated token etc.
      headers: this.authHeaders(token),
    });
    try {
      return await this.processResponse<T>(
        res,
        "An error occurred while fetching the data.\n",
      );
    } catch (error) {
      this.handleUnauthorized((error as Partial<ApplicationError>)?.status);
      throw error;
    }
  }

  public async postWithAuth<T>(
    endpoint: string,
    data: unknown,
    token: string,
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.authHeaders(token),
      body: JSON.stringify(data),
    });
    try {
      return await this.processResponse<T>(
        res,
        "An error occurred while posting the data.\n",
      );
    } catch (error) {
      this.handleUnauthorized((error as Partial<ApplicationError>)?.status);
      throw error;
    }
  }

  public async putWithAuth<T>(
    endpoint: string,
    data: unknown,
    token: string,
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.authHeaders(token),
      body: JSON.stringify(data),
    });
    try {
      return await this.processResponse<T>(
        res,
        "An error occurred while updating the data.\n",
      );
    } catch (error) {
      this.handleUnauthorized((error as Partial<ApplicationError>)?.status);
      throw error;
    }
  }

  public async patchWithAuth<T>(
    endpoint: string,
    data: unknown,
    token: string,
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: this.authHeaders(token),
      body: JSON.stringify(data),
    });
    try {
      return await this.processResponse<T>(
        res,
        "An error occurred while updating the data.\n",
      );
    } catch (error) {
      this.handleUnauthorized((error as Partial<ApplicationError>)?.status);
      throw error;
    }
  }

  public async deleteWithAuth<T>(
      endpoint: string,
      token: string,
    ): Promise<T> {
      const url = `${this.baseURL}${endpoint}`;
      const res = await fetch(url, {
          method: "DELETE",
          headers: this.authHeaders(token),
      });
        try {
          return await this.processResponse<T>(
              res,
              "An error occurred while deleting the data.\n",
          );
      } catch (error) {
          this.handleUnauthorized((error as Partial<ApplicationError>)?.status);
      throw error;
    }
  }
}
