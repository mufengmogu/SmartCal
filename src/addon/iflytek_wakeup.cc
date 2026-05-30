#include <napi.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <string>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
typedef HMODULE LibHandle;
#define LOAD_LIB(path) LoadLibraryA(path)
#define GET_PROC(handle, name) GetProcAddress(handle, name)
#define FREE_LIB(handle) FreeLibrary(handle)
#else
#include <dlfcn.h>
typedef void* LibHandle;
#define LOAD_LIB(path) dlopen(path, RTLD_LAZY)
#define GET_PROC(handle, name) dlsym(handle, name)
#define FREE_LIB(handle) dlclose(handle)
#endif

typedef void* AIKIT_HANDLE;
typedef int32_t AIKIT_EVENT;

typedef struct {
  int32_t nodeSize;
  int32_t size;
  char key[64];
  char value[256];
  int32_t index;
} AIKIT_BizParam;

typedef struct {
  int32_t nodeSize;
  int32_t size;
  char key[64];
  int32_t type;
  char value[256];
  int32_t index;
  int32_t reserved;
} AIKIT_CustomData;

typedef struct {
  AIKIT_BizParam* params;
  int32_t count;
} AIKIT_BizParamBuilder;

typedef struct {
  int32_t type;
  AIKIT_CustomData* data;
  int32_t nodeSize;
  int32_t size;
  char key[64];
  int32_t index;
  int32_t reserved;
} AIKIT_OutputData;

typedef struct {
  int32_t type;
  void* value;
} AIKIT_OutputEvent;

typedef struct {
  void (*OnOutput)(AIKIT_HANDLE*, AIKIT_OutputData*);
  void (*OnEvent)(AIKIT_HANDLE*, AIKIT_EVENT, AIKIT_OutputEvent*);
  void (*OnError)(AIKIT_HANDLE*, int32_t, const char*);
} AIKIT_Callbacks;

typedef AIKIT_HANDLE* (*AIKIT_InitFn)(AIKIT_BizParamBuilder*);
typedef int32_t (*AIKIT_UnInitFn)(AIKIT_HANDLE*);
typedef int32_t (*AIKIT_RegisterAbilityCallbackFn)(AIKIT_HANDLE*, const char*, AIKIT_Callbacks);
typedef AIKIT_HANDLE* (*AIKIT_StartFn)(AIKIT_HANDLE*, const char*, AIKIT_BizParamBuilder*, void*, AIKIT_HANDLE**);
typedef int32_t (*AIKIT_WriteFn)(AIKIT_HANDLE*, const char*, void*, int32_t);
typedef int32_t (*AIKIT_EndFn)(AIKIT_HANDLE*);
typedef int32_t (*AIKIT_LoadDataFn)(AIKIT_HANDLE*, const char*, AIKIT_CustomData*);
typedef int32_t (*AIKIT_SpecifyDataSetFn)(AIKIT_HANDLE*, const char*, const char*, int*, int);

class IflytekWakeupAddon : public Napi::ObjectWrap<IflytekWakeupAddon> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  IflytekWakeupAddon(const Napi::CallbackInfo& info);
  ~IflytekWakeupAddon();

private:
  Napi::Value Initialize(const Napi::CallbackInfo& info);
  Napi::Value StartWakeup(const Napi::CallbackInfo& info);
  Napi::Value StopWakeup(const Napi::CallbackInfo& info);
  Napi::Value WriteAudio(const Napi::CallbackInfo& info);
  Napi::Value IsRunning(const Napi::CallbackInfo& info);

  bool LoadSDK(const std::string& libPath);
  void UnloadSDK();
  static void OnWakeupResult(AIKIT_HANDLE* handle, AIKIT_OutputData* output);
  static void OnWakeupEvent(AIKIT_HANDLE* handle, AIKIT_EVENT eventType, AIKIT_OutputEvent* eventValue);
  static void OnWakeupError(AIKIT_HANDLE* handle, int32_t err, const char* desc);

  LibHandle m_hLib;
  AIKIT_HANDLE* m_sdkHandle;
  AIKIT_HANDLE* m_sessionHandle;
  std::atomic<bool> m_isRunning;
  std::mutex m_mutex;

  AIKIT_InitFn m_pfnInit;
  AIKIT_UnInitFn m_pfnUnInit;
  AIKIT_RegisterAbilityCallbackFn m_pfnRegisterCallback;
  AIKIT_StartFn m_pfnStart;
  AIKIT_WriteFn m_pfnWrite;
  AIKIT_EndFn m_pfnEnd;
  AIKIT_LoadDataFn m_pfnLoadData;
  AIKIT_SpecifyDataSetFn m_pfnSpecifyDataSet;

  Napi::ThreadSafeFunction m_callback;

  static IflytekWakeupAddon* s_instance;
  static const char* ABILITY_ID;
};

IflytekWakeupAddon* IflytekWakeupAddon::s_instance = nullptr;
const char* IflytekWakeupAddon::ABILITY_ID = "e867a88f2";

Napi::Object IflytekWakeupAddon::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "IflytekWakeup", {
    InstanceMethod("initialize", &IflytekWakeupAddon::Initialize),
    InstanceMethod("startWakeup", &IflytekWakeupAddon::StartWakeup),
    InstanceMethod("stopWakeup", &IflytekWakeupAddon::StopWakeup),
    InstanceMethod("writeAudio", &IflytekWakeupAddon::WriteAudio),
    InstanceMethod("isRunning", &IflytekWakeupAddon::IsRunning)
  });

  Napi::FunctionReference* constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  env.SetInstanceData(constructor);

  exports.Set("IflytekWakeup", func);
  return exports;
}

IflytekWakeupAddon::IflytekWakeupAddon(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<IflytekWakeupAddon>(info),
    m_hLib(nullptr),
    m_sdkHandle(nullptr),
    m_sessionHandle(nullptr),
    m_isRunning(false),
    m_pfnInit(nullptr), m_pfnUnInit(nullptr),
    m_pfnRegisterCallback(nullptr), m_pfnStart(nullptr),
    m_pfnWrite(nullptr), m_pfnEnd(nullptr),
    m_pfnLoadData(nullptr), m_pfnSpecifyDataSet(nullptr) {
  s_instance = this;
}

IflytekWakeupAddon::~IflytekWakeupAddon() {
  StopWakeup(Napi::CallbackInfo());
  UnloadSDK();
  s_instance = nullptr;
}

bool IflytekWakeupAddon::LoadSDK(const std::string& libPath) {
  m_hLib = LOAD_LIB(libPath.c_str());
  if (!m_hLib) return false;

  m_pfnInit = (AIKIT_InitFn)GET_PROC(m_hLib, "AIKIT_Init");
  m_pfnUnInit = (AIKIT_UnInitFn)GET_PROC(m_hLib, "AIKIT_UnInit");
  m_pfnRegisterCallback = (AIKIT_RegisterAbilityCallbackFn)GET_PROC(m_hLib, "AIKIT_RegisterAbilityCallback");
  m_pfnStart = (AIKIT_StartFn)GET_PROC(m_hLib, "AIKIT_Start");
  m_pfnWrite = (AIKIT_WriteFn)GET_PROC(m_hLib, "AIKIT_Write");
  m_pfnEnd = (AIKIT_EndFn)GET_PROC(m_hLib, "AIKIT_End");
  m_pfnLoadData = (AIKIT_LoadDataFn)GET_PROC(m_hLib, "AIKIT_LoadData");
  m_pfnSpecifyDataSet = (AIKIT_SpecifyDataSetFn)GET_PROC(m_hLib, "AIKIT_SpecifyDataSet");

  return m_pfnInit && m_pfnStart && m_pfnWrite && m_pfnEnd;
}

void IflytekWakeupAddon::UnloadSDK() {
  if (m_hLib) {
    if (m_pfnUnInit && m_sdkHandle) {
      m_pfnUnInit(m_sdkHandle);
    }
    FREE_LIB(m_hLib);
    m_hLib = nullptr;
  }
  m_sdkHandle = nullptr;
}

Napi::Value IflytekWakeupAddon::Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 4) {
    Napi::TypeError::New(env, "需要参数: libPath, appId, apiKey, apiSecret").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string libPath = info[0].As<Napi::String>().Utf8Value();
  std::string appId = info[1].As<Napi::String>().Utf8Value();
  std::string apiKey = info[2].As<Napi::String>().Utf8Value();
  std::string apiSecret = info[3].As<Napi::String>().Utf8Value();

  if (!LoadSDK(libPath)) {
    Napi::Error::New(env, "无法加载科大讯飞SDK库文件").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  AIKIT_BizParam params[] = {
    {sizeof(AIKIT_BizParam), 0, "appID", "", 0},
    {sizeof(AIKIT_BizParam), 0, "apiKey", "", 0},
    {sizeof(AIKIT_BizParam), 0, "apiSecret", "", 0},
    {sizeof(AIKIT_BizParam), 0, "workDir", "", 0},
    {sizeof(AIKIT_BizParam), 0, "ability", "", 0}
  };

  strncpy(params[0].value, appId.c_str(), 255);
  strncpy(params[1].value, apiKey.c_str(), 255);
  strncpy(params[2].value, apiSecret.c_str(), 255);
  strncpy(params[3].value, "./iflytek_workdir", 255);
  strncpy(params[4].value, ABILITY_ID, 255);

  for (auto& p : params) {
    p.size = (int32_t)strlen(p.value);
  }

  AIKIT_BizParamBuilder builder = {params, 5};
  m_sdkHandle = m_pfnInit(&builder);

  if (!m_sdkHandle) {
    UnloadSDK();
    Napi::Error::New(env, "科大讯飞SDK初始化失败").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  AIKIT_Callbacks cb;
  cb.OnOutput = OnWakeupResult;
  cb.OnEvent = OnWakeupEvent;
  cb.OnError = OnWakeupError;

  int32_t ret = m_pfnRegisterCallback(m_sdkHandle, ABILITY_ID, cb);
  if (ret != 0) {
    Napi::Error::New(env, "注册回调失败").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value IflytekWakeupAddon::StartWakeup(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!m_sdkHandle) {
    Napi::Error::New(env, "SDK未初始化").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  if (info.Length() > 0 && info[0].IsFunction()) {
    m_callback = Napi::ThreadSafeFunction::New(
      env, info[0].As<Napi::Function>(),
      "WakeupCallback", 0, 1
    );
  }

  AIKIT_BizParam params[] = {
    {sizeof(AIKIT_BizParam), 0, "wdec_param_nCmThreshold", "", 0}
  };
  strncpy(params[0].value, "0 0:1500", 255);
  params[0].size = (int32_t)strlen(params[0].value);

  AIKIT_BizParamBuilder builder = {params, 1};

  m_sessionHandle = nullptr;
  AIKIT_HANDLE* result = m_pfnStart(m_sdkHandle, ABILITY_ID, &builder, nullptr, &m_sessionHandle);

  if (!result || !m_sessionHandle) {
    Napi::Error::New(env, "启动唤醒会话失败").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  m_isRunning = true;
  return Napi::Boolean::New(env, true);
}

Napi::Value IflytekWakeupAddon::StopWakeup(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  m_isRunning = false;

  if (m_sessionHandle && m_pfnEnd) {
    m_pfnEnd(m_sessionHandle);
    m_sessionHandle = nullptr;
  }

  if (m_callback) {
    m_callback.Release();
  }

  return Napi::Boolean::New(env, true);
}

Napi::Value IflytekWakeupAddon::WriteAudio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (!m_isRunning || !m_sessionHandle) {
    return Napi::Boolean::New(env, false);
  }

  if (info.Length() < 1) {
    return Napi::Boolean::New(env, false);
  }

  Napi::Buffer<char> buf = info[0].As<Napi::Buffer<char>>();
  int32_t ret = m_pfnWrite(m_sessionHandle, "wav", buf.Data(), buf.Length());

  return Napi::Boolean::New(env, ret == 0);
}

Napi::Value IflytekWakeupAddon::IsRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), m_isRunning.load());
}

void IflytekWakeupAddon::OnWakeupResult(AIKIT_HANDLE* handle, AIKIT_OutputData* output) {
  if (s_instance && s_instance->m_callback) {
    std::string result(output->data[0].value, output->data[0].size);
    auto callback = [result](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({Napi::String::New(env, result)});
    };
    s_instance->m_callback.BlockingCall(callback);
  }
}

void IflytekWakeupAddon::OnWakeupEvent(AIKIT_HANDLE* handle, AIKIT_EVENT eventType, AIKIT_OutputEvent* eventValue) {
}

void IflytekWakeupAddon::OnWakeupError(AIKIT_HANDLE* handle, int32_t err, const char* desc) {
  if (s_instance && s_instance->m_callback) {
    std::string errDesc(desc ? desc : "未知错误");
    auto callback = [err, errDesc](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({
        Napi::String::New(env, "error"),
        Napi::Number::New(env, err),
        Napi::String::New(env, errDesc)
      });
    };
    s_instance->m_callback.BlockingCall(callback);
  }
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return IflytekWakeupAddon::Init(env, exports);
}

NODE_API_MODULE(iflytek_wakeup, InitAll)