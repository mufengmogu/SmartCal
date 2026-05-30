{
  "targets": [
    {
      "target_name": "iflytek_wakeup",
      "sources": ["src/addon/iflytek_wakeup.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "libs/iflytek/include"
      ],
      "libraries": [
        "-Llibs/iflytek/libs/x64",
        "-lAIKit"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/utf-8"]
        }
      }
    }
  ]
}