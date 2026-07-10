<template>
  <el-dialog 
    v-model="visible" 
    title="数据集结构配置"
    width="800px"
    :close-on-click-modal="false"
  >
    <div class="structure-dialog">
      <!-- 识别结果概览 -->
      <el-alert 
        :title="`识别结果：${getStructureTypeText()}`"
        :type="structureType === 'unknown' ? 'warning' : 'success'"
        show-icon
        :closable="false"
        class="mb-4"
      />
      
      <!-- 数据集拆分信息 -->
      <div class="section" v-if="datasetSplits.length > 0">
        <h3>数据集拆分</h3>
        <el-table :data="datasetSplits" border size="small">
          <el-table-column prop="name" label="拆分类型" width="100">
            <template #default="{ row }">
              <el-tag :type="getSplitTypeColor(row.name)">
                {{ getSplitTypeText(row.name) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="imagePath" label="图片路径" />
          <el-table-column prop="annotationPath" label="标注路径" />
          <el-table-column prop="imageCount" label="图片数量" width="100" />
          <el-table-column prop="annotationCount" label="标注数量" width="100" />
        </el-table>
      </div>
      
      <!-- 标注格式 -->
      <div class="section">
        <h3>标注格式</h3>
        <el-radio-group v-model="annotationFormat">
          <el-radio value="yolo">YOLO (.txt)</el-radio>
          <el-radio value="voc">VOC (.xml)</el-radio>
          <el-radio value="coco">COCO (.json)</el-radio>
          <el-radio value="labelme">LabelMe (.json)</el-radio>
          <el-radio value="custom">自定义</el-radio>
        </el-radio-group>
      </div>
      
      <!-- 匹配规则配置 -->
      <div class="section">
        <h3>文件匹配规则</h3>
        <el-form label-width="120px" size="small">
          <el-form-item label="匹配方式">
            <el-radio-group v-model="matchingRule.type">
              <el-radio value="same_name">相同文件名</el-radio>
              <el-radio value="same_dir">同一目录</el-radio>
              <el-radio value="custom">自定义规则</el-radio>
            </el-radio-group>
          </el-form-item>
          
          <el-form-item label="图片文件模式">
            <el-input v-model="matchingRule.imagePattern" placeholder="{name}.jpg" />
            <div class="form-hint">使用 {name} 代替文件名（不含扩展名）</div>
          </el-form-item>
          
          <el-form-item label="标注文件模式">
            <el-input v-model="matchingRule.annotationPattern" placeholder="{name}.txt" />
            <div class="form-hint">使用 {name} 代替文件名（不含扩展名）</div>
          </el-form-item>
          
          <el-form-item label="自定义规则" v-if="matchingRule.type === 'custom'">
            <el-input 
              v-model="matchingRule.customRule" 
              type="textarea" 
              :rows="3"
              placeholder="请输入自定义匹配规则"
            />
          </el-form-item>
        </el-form>
      </div>
      
      <!-- 手动配置路径 -->
      <div class="section">
        <h3>手动配置路径</h3>
        <p class="hint">如果自动识别不准确，可以手动配置文件路径：</p>
        
        <div class="path-config" v-for="(split, index) in datasetSplits" :key="index">
          <el-divider content-position="left">
            {{ getSplitTypeText(split.name) }} 数据集
          </el-divider>
          
          <el-form label-width="120px" size="small">
            <el-form-item label="图片目录">
              <el-input v-model="split.imagePath" placeholder="例如：train/images" />
            </el-form-item>
            
            <el-form-item label="标注目录">
              <el-input v-model="split.annotationPath" placeholder="例如：train/labels" />
            </el-form-item>
          </el-form>
        </div>
      </div>
      
      <!-- 匹配测试结果 -->
      <div class="section">
        <h3>匹配测试</h3>
        <el-button @click="testMatching" size="small" type="primary">
          测试匹配规则
        </el-button>
        
        <div v-if="testResults.length > 0" class="test-results">
          <h4>测试结果（前10条）：</h4>
          <el-table :data="testResults.slice(0, 10)" border size="small">
            <el-table-column prop="imageName" label="图片文件" />
            <el-table-column prop="annotationName" label="标注文件" />
            <el-table-column prop="matched" label="匹配状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.matched ? 'success' : 'danger'">
                  {{ row.matched ? '已匹配' : '未匹配' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          
          <div class="test-summary">
            匹配率：{{ matchedCount }}/{{ testResults.length }} ({{ matchRate }}%)
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleConfirm">确认</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { 
  StructureAnalysisResult, 
  MatchingRule, 
  DatasetSplit,
  AnnotationFormat 
} from '../types'

// Props
const props = defineProps<{
  modelValue: boolean
  analysisResult?: StructureAnalysisResult
  imageFiles: any[]
  annotationFiles: any[]
}>()

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [config: DatasetConfig]
}>()

// 状态
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const structureType = ref<StructureAnalysisResult['structureType']>('unknown')
const datasetSplits = ref<DatasetSplit[]>([])
const annotationFormat = ref<AnnotationFormat>('yolo')
const matchingRule = ref<MatchingRule>({
  type: 'same_name',
  imagePattern: '{name}.jpg',
  annotationPattern: '{name}.txt'
})

// 测试结果
const testResults = ref<any[]>([])
const matchedCount = computed(() => 
  testResults.value.filter(r => r.matched).length
)
const matchRate = computed(() => 
  testResults.value.length > 0 ? 
  Math.round((matchedCount.value / testResults.value.length) * 100) : 0
)

// 数据集配置接口
interface DatasetConfig {
  structureType: StructureAnalysisResult['structureType']
  datasetSplits: DatasetSplit[]
  annotationFormat: AnnotationFormat
  matchingRule: MatchingRule
}

// 方法
function getStructureTypeText() {
  const map: Record<string, string> = {
    'separated': '图片和标注分开存储',
    'merged': '图片和标注在同一目录',
    'hierarchical': '按类别分层存储',
    'unknown': '无法识别，请手动配置'
  }
  return map[structureType.value] || '未知'
}

function getSplitTypeText(type: string) {
  const map: Record<string, string> = {
    'train': '训练集',
    'val': '验证集',
    'test': '测试集',
    'unknown': '未知'
  }
  return map[type] || type
}

function getSplitTypeColor(type: string) {
  const map: Record<string, 'warning' | 'success' | 'info' | undefined> = {
    'train': undefined,
    'val': 'warning',
    'test': 'success',
    'unknown': 'info'
  }
  return map[type]
}

function testMatching() {
  // 测试匹配规则
  const results: any[] = []
  
  for (const imageFile of props.imageFiles.slice(0, 100)) {
    const imageName = imageFile.name.substring(0, imageFile.name.lastIndexOf('.'))
    
    // 根据规则查找标注文件
    let annotationName = ''
    if (matchingRule.value.type === 'same_name') {
      const ext = matchingRule.value.annotationPattern.substring(
        matchingRule.value.annotationPattern.lastIndexOf('.')
      )
      annotationName = imageName + ext
    }
    
    const matched = props.annotationFiles.some(f => f.name === annotationName)
    
    results.push({
      imageName: imageFile.name,
      annotationName,
      matched
    })
  }
  
  testResults.value = results
  
  if (results.length > 0) {
    ElMessage.success(`测试完成，匹配率：${matchRate.value}%`)
  } else {
    ElMessage.warning('没有图片文件可供测试')
  }
}

function handleConfirm() {
  const config: DatasetConfig = {
    structureType: structureType.value,
    datasetSplits: datasetSplits.value,
    annotationFormat: annotationFormat.value,
    matchingRule: matchingRule.value
  }
  
  emit('confirm', config)
  visible.value = false
}

// 初始化
if (props.analysisResult) {
  structureType.value = props.analysisResult.structureType
  datasetSplits.value = props.analysisResult.datasetSplits
  annotationFormat.value = props.analysisResult.annotationFormat
  matchingRule.value = props.analysisResult.matchingRule
}
</script>

<style scoped>
.structure-dialog {
  max-height: 70vh;
  overflow-y: auto;
}

.section {
  margin-bottom: 24px;
}

.section h3 {
  margin-bottom: 12px;
  font-size: 16px;
  color: #303133;
}

.hint {
  color: #909399;
  font-size: 12px;
  margin-bottom: 12px;
}

.form-hint {
  color: #909399;
  font-size: 11px;
  margin-top: 4px;
}

.path-config {
  margin-top: 16px;
}

.test-results {
  margin-top: 16px;
}

.test-summary {
  margin-top: 12px;
  padding: 12px;
  background: #f0f9ff;
  border-radius: 4px;
  font-size: 14px;
}

.mb-4 {
  margin-bottom: 16px;
}
</style>
